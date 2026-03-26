create extension if not exists pgcrypto;

alter table if exists public.os_rooms
  add column if not exists supports_screenshot_block boolean not null default false;

alter table if exists public.os_messages
  add column if not exists is_pinned boolean not null default false,
  add column if not exists deleted_at timestamptz;

alter table if exists public.os_business_objects
  drop constraint if exists os_business_objects_object_type_check;

alter table if exists public.os_business_objects
  add constraint os_business_objects_object_type_check
  check (object_type in ('order','payment','agreement','dispute','task','reminder','deal_offer','snapshot'));

create table if not exists public.os_snapshots (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.os_rooms(id) on delete cascade,
  business_object_id uuid references public.os_business_objects(id) on delete set null,
  trigger_event text not null check (trigger_event in ('order_created', 'agreement_signed', 'payment_confirmed', 'deal_accepted')),
  state_snapshot_hash text not null,
  immutable_payload jsonb not null default '{}'::jsonb,
  legal_hold boolean not null default false,
  created_by_merchant_id text not null,
  created_at timestamptz not null default now(),
  unique (state_snapshot_hash)
);

create table if not exists public.os_trust_metrics (
  id uuid primary key default gen_random_uuid(),
  merchant_id text not null,
  response_speed_score numeric(5,2) not null default 0,
  completion_rate_score numeric(5,2) not null default 0,
  dispute_rate_score numeric(5,2) not null default 0,
  verification_score numeric(5,2) not null default 0,
  trust_score numeric(5,2) not null default 0,
  factors jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  unique (merchant_id)
);

create table if not exists public.os_vault_items (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.os_rooms(id) on delete cascade,
  created_by_merchant_id text not null,
  item_type text not null check (item_type in ('document','payment_reference','identifier')),
  title text not null,
  payload jsonb not null default '{}'::jsonb,
  expires_at timestamptz,
  legal_hold boolean not null default false,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.os_location_shares (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.os_rooms(id) on delete cascade,
  sender_merchant_id text not null,
  location_mode text not null check (location_mode in ('one_time','live','arrival_confirmation')),
  lat numeric(10, 7) not null,
  lng numeric(10, 7) not null,
  expires_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.os_call_sessions (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.os_rooms(id) on delete cascade,
  initiated_by_merchant_id text not null,
  call_type text not null check (call_type in ('voice', 'video')),
  recording_restricted boolean not null default true,
  identity_masking_enabled boolean not null default false,
  expires_at timestamptz,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.os_call_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.os_call_sessions(id) on delete cascade,
  room_id uuid not null references public.os_rooms(id) on delete cascade,
  event_type text not null,
  actor_merchant_id text,
  created_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb
);

create table if not exists public.os_compliance_holds (
  id uuid primary key default gen_random_uuid(),
  target_entity_type text not null check (target_entity_type in ('message', 'vault_item', 'snapshot', 'room')),
  target_entity_id text not null,
  reason text not null,
  created_by text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  released_at timestamptz
);

create index if not exists idx_os_messages_visibility on public.os_messages(room_id, created_at desc, expires_at, deleted_at);
create index if not exists idx_os_messages_unread on public.os_messages(room_id, read_at) where read_at is null;
create index if not exists idx_os_snapshots_room_created on public.os_snapshots(room_id, created_at desc);
create index if not exists idx_os_vault_items_room_expiry on public.os_vault_items(room_id, expires_at, deleted_at);
create index if not exists idx_os_location_room_expiry on public.os_location_shares(room_id, expires_at);
create index if not exists idx_os_call_sessions_room_created on public.os_call_sessions(room_id, started_at desc);
create index if not exists idx_os_compliance_holds_target on public.os_compliance_holds(target_entity_type, target_entity_id, active);

alter table public.os_snapshots enable row level security;
alter table public.os_trust_metrics enable row level security;
alter table public.os_vault_items enable row level security;
alter table public.os_location_shares enable row level security;
alter table public.os_call_sessions enable row level security;
alter table public.os_call_events enable row level security;
alter table public.os_compliance_holds enable row level security;

drop policy if exists "os_snapshots_member_select" on public.os_snapshots;
create policy "os_snapshots_member_select" on public.os_snapshots for select to authenticated using (
  exists (select 1 from public.os_room_members m where m.room_id = os_snapshots.room_id and m.merchant_id = public.current_merchant_id())
);

drop policy if exists "os_snapshots_member_insert" on public.os_snapshots;
create policy "os_snapshots_member_insert" on public.os_snapshots for insert to authenticated with check (
  created_by_merchant_id = public.current_merchant_id() and
  exists (select 1 from public.os_room_members m where m.room_id = os_snapshots.room_id and m.merchant_id = public.current_merchant_id())
);

drop policy if exists "os_trust_metrics_member_select" on public.os_trust_metrics;
create policy "os_trust_metrics_member_select" on public.os_trust_metrics for select to authenticated using (true);

drop policy if exists "os_trust_metrics_self_upsert" on public.os_trust_metrics;
create policy "os_trust_metrics_self_upsert" on public.os_trust_metrics for insert to authenticated with check (merchant_id = public.current_merchant_id());

drop policy if exists "os_trust_metrics_self_update" on public.os_trust_metrics;
create policy "os_trust_metrics_self_update" on public.os_trust_metrics for update to authenticated using (merchant_id = public.current_merchant_id()) with check (merchant_id = public.current_merchant_id());

drop policy if exists "os_vault_items_member_select" on public.os_vault_items;
create policy "os_vault_items_member_select" on public.os_vault_items for select to authenticated using (
  exists (select 1 from public.os_room_members m where m.room_id = os_vault_items.room_id and m.merchant_id = public.current_merchant_id())
);

drop policy if exists "os_vault_items_member_insert" on public.os_vault_items;
create policy "os_vault_items_member_insert" on public.os_vault_items for insert to authenticated with check (
  created_by_merchant_id = public.current_merchant_id() and
  exists (select 1 from public.os_room_members m where m.room_id = os_vault_items.room_id and m.merchant_id = public.current_merchant_id())
);

drop policy if exists "os_vault_items_member_update" on public.os_vault_items;
create policy "os_vault_items_member_update" on public.os_vault_items for update to authenticated using (
  exists (select 1 from public.os_room_members m where m.room_id = os_vault_items.room_id and m.merchant_id = public.current_merchant_id())
) with check (
  exists (select 1 from public.os_room_members m where m.room_id = os_vault_items.room_id and m.merchant_id = public.current_merchant_id())
);

drop policy if exists "os_location_member_select" on public.os_location_shares;
create policy "os_location_member_select" on public.os_location_shares for select to authenticated using (
  exists (select 1 from public.os_room_members m where m.room_id = os_location_shares.room_id and m.merchant_id = public.current_merchant_id())
);

drop policy if exists "os_location_member_insert" on public.os_location_shares;
create policy "os_location_member_insert" on public.os_location_shares for insert to authenticated with check (
  sender_merchant_id = public.current_merchant_id() and
  exists (select 1 from public.os_room_members m where m.room_id = os_location_shares.room_id and m.merchant_id = public.current_merchant_id())
);

drop policy if exists "os_calls_member_select" on public.os_call_sessions;
create policy "os_calls_member_select" on public.os_call_sessions for select to authenticated using (
  exists (select 1 from public.os_room_members m where m.room_id = os_call_sessions.room_id and m.merchant_id = public.current_merchant_id())
);

drop policy if exists "os_calls_member_insert" on public.os_call_sessions;
create policy "os_calls_member_insert" on public.os_call_sessions for insert to authenticated with check (
  initiated_by_merchant_id = public.current_merchant_id() and
  exists (select 1 from public.os_room_members m where m.room_id = os_call_sessions.room_id and m.merchant_id = public.current_merchant_id())
);

drop policy if exists "os_call_events_member_select" on public.os_call_events;
create policy "os_call_events_member_select" on public.os_call_events for select to authenticated using (
  exists (select 1 from public.os_room_members m where m.room_id = os_call_events.room_id and m.merchant_id = public.current_merchant_id())
);

drop policy if exists "os_call_events_member_insert" on public.os_call_events;
create policy "os_call_events_member_insert" on public.os_call_events for insert to authenticated with check (
  exists (select 1 from public.os_room_members m where m.room_id = os_call_events.room_id and m.merchant_id = public.current_merchant_id())
);

drop policy if exists "os_compliance_admin_select" on public.os_compliance_holds;
create policy "os_compliance_admin_select" on public.os_compliance_holds for select to authenticated using (
  exists(select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin')
);

drop policy if exists "os_compliance_admin_insert" on public.os_compliance_holds;
create policy "os_compliance_admin_insert" on public.os_compliance_holds for insert to authenticated with check (
  exists(select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin')
);

create or replace function public.os_create_message(
  _room_id uuid,
  _content text,
  _permissions jsonb default null,
  _retention_policy text default null,
  _expires_at timestamptz default null,
  _view_limit integer default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  _room public.os_rooms;
  _msg_id uuid;
  _effective_permissions jsonb;
  _effective_retention text;
begin
  select * into _room from public.os_rooms where id = _room_id;
  if not found then
    raise exception 'Room not found';
  end if;

  if not exists (
    select 1 from public.os_room_members m
    where m.room_id = _room_id and m.merchant_id = public.current_merchant_id()
  ) then
    raise exception 'Not a room member';
  end if;

  _effective_permissions := coalesce(_permissions, jsonb_build_object(
    'forwardable', not coalesce((_room.security_policies->>'disable_forwarding')::boolean, false),
    'exportable', not coalesce((_room.security_policies->>'disable_export')::boolean, false),
    'copyable', not coalesce((_room.security_policies->>'disable_copy')::boolean, false),
    'ai_readable', true
  ));

  _effective_retention := coalesce(_retention_policy, _room.retention_policy);

  insert into public.os_messages(
    room_id,
    sender_merchant_id,
    content,
    permissions,
    retention_policy,
    expires_at,
    view_limit
  ) values (
    _room_id,
    public.current_merchant_id(),
    _content,
    _effective_permissions,
    _effective_retention,
    _expires_at,
    _view_limit
  ) returning id into _msg_id;

  return _msg_id;
end;
$$;

create or replace function public.os_mark_room_read(_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.os_room_members m
    where m.room_id = _room_id and m.merchant_id = public.current_merchant_id()
  ) then
    raise exception 'Not a room member';
  end if;

  update public.os_messages
  set read_at = now()
  where room_id = _room_id
    and sender_merchant_id <> public.current_merchant_id()
    and read_at is null;
end;
$$;

create or replace function public.os_search_messages(
  _room_id uuid,
  _query text,
  _limit integer default 50
)
returns table(
  id uuid,
  room_id uuid,
  sender_merchant_id text,
  content text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select m.id, m.room_id, m.sender_merchant_id, m.content, m.created_at
  from public.os_messages m
  where m.room_id = _room_id
    and m.deleted_at is null
    and (
      m.is_pinned = true
      or m.expires_at is null
      or m.expires_at > now()
      or exists (
        select 1 from public.os_compliance_holds h
        where h.target_entity_type = 'message'
          and h.target_entity_id = m.id::text
          and h.active = true
      )
    )
    and m.content ilike ('%' || _query || '%')
  order by m.created_at desc
  limit greatest(1, least(_limit, 200));
$$;

create or replace function public.os_create_snapshot(
  _room_id uuid,
  _business_object_id uuid,
  _trigger_event text,
  _immutable_payload jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  _snapshot_id uuid;
  _hash text;
begin
  if not exists (
    select 1 from public.os_room_members m
    where m.room_id = _room_id and m.merchant_id = public.current_merchant_id()
  ) then
    raise exception 'Not a room member';
  end if;

  _hash := '0x' || encode(gen_random_bytes(16), 'hex');

  insert into public.os_snapshots(room_id, business_object_id, trigger_event, state_snapshot_hash, immutable_payload, created_by_merchant_id)
  values (_room_id, _business_object_id, _trigger_event, _hash, _immutable_payload, public.current_merchant_id())
  returning id into _snapshot_id;

  update public.os_business_objects
  set state_snapshot_hash = _hash,
      status = 'locked'
  where id = _business_object_id;

  return _snapshot_id;
end;
$$;

create or replace function public.os_accept_negotiation_terms(
  _business_object_id uuid,
  _trigger_event text default 'deal_accepted'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  _room_id uuid;
  _snapshot_id uuid;
begin
  select room_id into _room_id from public.os_business_objects where id = _business_object_id;
  if _room_id is null then
    raise exception 'Business object not found';
  end if;

  select public.os_create_snapshot(
    _room_id,
    _business_object_id,
    _trigger_event,
    jsonb_build_object('accepted_by', public.current_merchant_id(), 'accepted_at', now())
  ) into _snapshot_id;

  return _snapshot_id;
end;
$$;

create or replace function public.os_set_legal_hold(
  _target_entity_type text,
  _target_entity_id text,
  _reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  _id uuid;
begin
  if not exists(select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin') then
    raise exception 'Admin role required';
  end if;

  insert into public.os_compliance_holds(target_entity_type, target_entity_id, reason, created_by)
  values (_target_entity_type, _target_entity_id, _reason, public.current_merchant_id())
  returning id into _id;

  if _target_entity_type = 'vault_item' then
    update public.os_vault_items set legal_hold = true where id::text = _target_entity_id;
  elsif _target_entity_type = 'snapshot' then
    update public.os_snapshots set legal_hold = true where id::text = _target_entity_id;
  end if;

  return _id;
end;
$$;

create or replace function public.os_compliance_fetch_message(_message_id uuid)
returns table(
  id uuid,
  room_id uuid,
  sender_merchant_id text,
  content text,
  created_at timestamptz,
  deleted_at timestamptz,
  expires_at timestamptz,
  legal_hold boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select m.id, m.room_id, m.sender_merchant_id, m.content, m.created_at, m.deleted_at, m.expires_at,
    exists(
      select 1 from public.os_compliance_holds h
      where h.target_entity_type = 'message' and h.target_entity_id = m.id::text and h.active = true
    ) as legal_hold
  from public.os_messages m
  where m.id = _message_id
    and exists(select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin');
$$;

create or replace function public.os_compliance_audit_query(
  _target_id text default null,
  _limit integer default 200
)
returns table(
  id uuid,
  action text,
  actor_merchant_id text,
  target_id text,
  immutable_payload jsonb,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select a.id, a.action, a.actor_merchant_id, a.target_id, a.immutable_payload, a.created_at
  from public.os_audit_events a
  where exists(select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'admin')
    and (_target_id is null or a.target_id = _target_id)
  order by a.created_at desc
  limit greatest(1, least(_limit, 1000));
$$;

create or replace function public.os_compute_trust_score(_merchant_id text default public.current_merchant_id())
returns table(
  merchant_id text,
  trust_score numeric,
  factors jsonb,
  response_speed_score numeric,
  completion_rate_score numeric,
  dispute_rate_score numeric,
  verification_score numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  _response numeric := 0;
  _completion numeric := 0;
  _dispute numeric := 0;
  _verification numeric := 0;
  _score numeric := 0;
  _factors jsonb := '[]'::jsonb;
begin
  select coalesce(avg(case when m.read_at is not null then 1 else 0 end) * 100, 0)
  into _response
  from public.os_messages m
  where m.sender_merchant_id = _merchant_id;

  select coalesce(avg(case when b.status in ('completed','locked') then 1 else 0 end) * 100, 0),
         coalesce(avg(case when b.object_type = 'dispute' and b.status in ('pending','accepted') then 1 else 0 end) * 100, 0)
  into _completion, _dispute
  from public.os_business_objects b
  join public.os_room_members rm on rm.room_id = b.room_id and rm.merchant_id = _merchant_id;

  select case when exists(select 1 from public.os_channel_identities i where i.merchant_id = _merchant_id and i.confidence_level = 'certain') then 100 else 40 end
  into _verification;

  _score := round(((_response * 0.25) + (_completion * 0.35) + ((100 - _dispute) * 0.2) + (_verification * 0.2))::numeric, 2);

  _factors := jsonb_build_array(
    jsonb_build_object('name','response_speed','value', round(_response::numeric,2)),
    jsonb_build_object('name','completion_rate','value', round(_completion::numeric,2)),
    jsonb_build_object('name','dispute_rate','value', round(_dispute::numeric,2)),
    jsonb_build_object('name','verification_status','value', round(_verification::numeric,2))
  );

  insert into public.os_trust_metrics(merchant_id, response_speed_score, completion_rate_score, dispute_rate_score, verification_score, trust_score, factors, updated_at)
  values(_merchant_id, round(_response::numeric,2), round(_completion::numeric,2), round(_dispute::numeric,2), round(_verification::numeric,2), _score, _factors, now())
  on conflict (merchant_id)
  do update set
    response_speed_score = excluded.response_speed_score,
    completion_rate_score = excluded.completion_rate_score,
    dispute_rate_score = excluded.dispute_rate_score,
    verification_score = excluded.verification_score,
    trust_score = excluded.trust_score,
    factors = excluded.factors,
    updated_at = now();

  return query
  select tm.merchant_id, tm.trust_score, tm.factors, tm.response_speed_score, tm.completion_rate_score, tm.dispute_rate_score, tm.verification_score
  from public.os_trust_metrics tm
  where tm.merchant_id = _merchant_id;
end;
$$;

create or replace function public.os_validate_mini_app_intent(
  _room_id uuid,
  _app_name text,
  _payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  _allowed boolean := false;
  _result jsonb;
begin
  if not exists (
    select 1 from public.os_room_members m
    where m.room_id = _room_id and m.merchant_id = public.current_merchant_id()
  ) then
    raise exception 'Not a room member';
  end if;

  _allowed := _app_name in ('calculator','order_form','balance_checker','schedule_tool');
  if not _allowed then
    raise exception 'Unsupported mini app';
  end if;

  _result := jsonb_build_object(
    'app', _app_name,
    'room_id', _room_id,
    'validated', true,
    'payload', coalesce(_payload, '{}'::jsonb),
    'validated_at', now()
  );

  insert into public.os_audit_events(action, actor_merchant_id, target_id, immutable_payload)
  values ('mini_app_invoked', public.current_merchant_id(), _room_id::text, _result);

  return _result;
end;
$$;

create or replace function public.os_cleanup_expired_content()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  _count integer := 0;
begin
  update public.os_messages m
  set deleted_at = now()
  where m.deleted_at is null
    and m.is_pinned = false
    and m.expires_at is not null
    and m.expires_at <= now()
    and not exists (
      select 1 from public.os_compliance_holds h
      where h.target_entity_type = 'message' and h.target_entity_id = m.id::text and h.active = true
    );

  get diagnostics _count = row_count;

  update public.os_vault_items v
  set deleted_at = now()
  where v.deleted_at is null
    and v.legal_hold = false
    and v.expires_at is not null
    and v.expires_at <= now();

  return _count;
end;
$$;

create or replace function public.os_on_business_object_state_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'locked' and (old.status is distinct from new.status) then
    perform public.os_create_snapshot(
      new.room_id,
      new.id,
      case
        when new.object_type = 'agreement' then 'agreement_signed'
        when new.object_type = 'payment' then 'payment_confirmed'
        else 'deal_accepted'
      end,
      jsonb_build_object('object_type', new.object_type, 'status', new.status)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_os_business_object_state_change on public.os_business_objects;
create trigger trg_os_business_object_state_change
after update on public.os_business_objects
for each row
execute function public.os_on_business_object_state_change();

-- Seed trust and vault baseline rows for earliest merchants
with ordered_merchants as (
  select merchant_id, row_number() over (order by created_at asc) as rn
  from public.merchant_profiles
)
insert into public.os_trust_metrics(merchant_id, factors, trust_score)
select merchant_id, '[]'::jsonb, 0
from ordered_merchants
where rn <= 2
on conflict (merchant_id) do nothing;
