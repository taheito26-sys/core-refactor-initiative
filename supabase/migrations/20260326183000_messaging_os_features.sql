create table if not exists public.os_threads (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.os_rooms(id) on delete cascade,
  routing_target text not null check (routing_target in ('dispute', 'approval', 'escalation', 'private')),
  source_message_ids uuid[] not null default '{}',
  promoted_at timestamptz not null default now(),
  created_by_merchant_id text not null
);

create table if not exists public.os_policies (
  id uuid primary key default gen_random_uuid(),
  target_entity_type text not null check (target_entity_type in ('Room', 'Message', 'Call')),
  target_entity_id uuid not null,
  rules jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by_merchant_id text not null
);

create table if not exists public.os_audit_events (
  id uuid primary key default gen_random_uuid(),
  action text not null,
  actor_merchant_id text,
  target_id text,
  immutable_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.os_workflow_runs (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.os_rooms(id) on delete cascade,
  source_message_id uuid references public.os_messages(id) on delete set null,
  business_object_id uuid references public.os_business_objects(id) on delete set null,
  workflow_type text not null,
  status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'failed')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz null
);

create table if not exists public.os_room_presence (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.os_rooms(id) on delete cascade,
  merchant_id text not null,
  is_focused boolean not null default false,
  last_seen_at timestamptz not null default now(),
  last_read_message_id uuid references public.os_messages(id) on delete set null,
  unique (room_id, merchant_id)
);

create index if not exists idx_os_threads_room on public.os_threads(room_id, promoted_at desc);
create index if not exists idx_os_audit_created on public.os_audit_events(created_at desc);
create index if not exists idx_os_workflow_room on public.os_workflow_runs(room_id, created_at desc);
create index if not exists idx_os_presence_room_merchant on public.os_room_presence(room_id, merchant_id);

alter table public.os_threads enable row level security;
alter table public.os_policies enable row level security;
alter table public.os_audit_events enable row level security;
alter table public.os_workflow_runs enable row level security;
alter table public.os_room_presence enable row level security;

drop policy if exists "os_threads_member_select" on public.os_threads;
create policy "os_threads_member_select"
on public.os_threads for select to authenticated
using (
  exists (
    select 1 from public.os_room_members m
    where m.room_id = os_threads.room_id
      and m.merchant_id = public.current_merchant_id()
  )
);

drop policy if exists "os_threads_member_insert" on public.os_threads;
create policy "os_threads_member_insert"
on public.os_threads for insert to authenticated
with check (
  created_by_merchant_id = public.current_merchant_id()
  and exists (
    select 1 from public.os_room_members m
    where m.room_id = os_threads.room_id
      and m.merchant_id = public.current_merchant_id()
  )
);

drop policy if exists "os_policies_member_select" on public.os_policies;
create policy "os_policies_member_select"
on public.os_policies for select to authenticated
using (
  exists (
    select 1
    from public.os_room_members m
    where m.room_id::text = os_policies.target_entity_id::text
      and m.merchant_id = public.current_merchant_id()
  )
);

drop policy if exists "os_policies_member_insert" on public.os_policies;
create policy "os_policies_member_insert"
on public.os_policies for insert to authenticated
with check (created_by_merchant_id = public.current_merchant_id());

drop policy if exists "os_audit_member_select" on public.os_audit_events;
create policy "os_audit_member_select"
on public.os_audit_events for select to authenticated
using (
  actor_merchant_id = public.current_merchant_id()
  or exists (
    select 1 from public.os_room_members m
    where m.room_id::text = os_audit_events.target_id
      and m.merchant_id = public.current_merchant_id()
  )
);

drop policy if exists "os_workflow_member_select" on public.os_workflow_runs;
create policy "os_workflow_member_select"
on public.os_workflow_runs for select to authenticated
using (
  exists (
    select 1 from public.os_room_members m
    where m.room_id = os_workflow_runs.room_id
      and m.merchant_id = public.current_merchant_id()
  )
);

drop policy if exists "os_workflow_member_insert" on public.os_workflow_runs;
create policy "os_workflow_member_insert"
on public.os_workflow_runs for insert to authenticated
with check (
  exists (
    select 1 from public.os_room_members m
    where m.room_id = os_workflow_runs.room_id
      and m.merchant_id = public.current_merchant_id()
  )
);

drop policy if exists "os_presence_member_select" on public.os_room_presence;
create policy "os_presence_member_select"
on public.os_room_presence for select to authenticated
using (
  exists (
    select 1 from public.os_room_members m
    where m.room_id = os_room_presence.room_id
      and m.merchant_id = public.current_merchant_id()
  )
);

drop policy if exists "os_presence_member_upsert" on public.os_room_presence;
create policy "os_presence_member_upsert"
on public.os_room_presence for insert to authenticated
with check (merchant_id = public.current_merchant_id());

drop policy if exists "os_presence_member_update" on public.os_room_presence;
create policy "os_presence_member_update"
on public.os_room_presence for update to authenticated
using (merchant_id = public.current_merchant_id())
with check (merchant_id = public.current_merchant_id());

create or replace function public.os_record_presence(
  _room_id uuid,
  _is_focused boolean,
  _last_read_message_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.os_room_members m
    where m.room_id = _room_id
      and m.merchant_id = public.current_merchant_id()
  ) then
    raise exception 'Not a member of this room';
  end if;

  insert into public.os_room_presence(room_id, merchant_id, is_focused, last_seen_at, last_read_message_id)
  values (_room_id, public.current_merchant_id(), _is_focused, now(), _last_read_message_id)
  on conflict (room_id, merchant_id)
  do update set
    is_focused = excluded.is_focused,
    last_seen_at = excluded.last_seen_at,
    last_read_message_id = coalesce(excluded.last_read_message_id, os_room_presence.last_read_message_id);
end;
$$;

create or replace function public.os_convert_message(
  _message_id uuid,
  _target_type text,
  _payload jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  _message public.os_messages;
  _new_id uuid;
begin
  select * into _message from public.os_messages where id = _message_id;
  if not found then
    raise exception 'Message not found';
  end if;

  if not exists (
    select 1 from public.os_room_members m
    where m.room_id = _message.room_id
      and m.merchant_id = public.current_merchant_id()
  ) then
    raise exception 'Not allowed to convert message';
  end if;

  insert into public.os_business_objects (
    room_id,
    object_type,
    source_message_id,
    created_by_merchant_id,
    payload,
    status
  )
  values (
    _message.room_id,
    _target_type,
    _message_id,
    public.current_merchant_id(),
    _payload,
    'pending'
  )
  returning id into _new_id;

  insert into public.os_workflow_runs (room_id, source_message_id, business_object_id, workflow_type, status, metadata)
  values (_message.room_id, _message_id, _new_id, 'convert_message', 'queued', jsonb_build_object('target_type', _target_type));

  insert into public.os_audit_events (action, actor_merchant_id, target_id, immutable_payload)
  values ('message_converted', public.current_merchant_id(), _new_id::text, jsonb_build_object('message_id', _message_id, 'target_type', _target_type));

  return _new_id;
end;
$$;

create or replace function public.os_promote_thread(
  _room_id uuid,
  _source_message_ids uuid[],
  _routing_target text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  _thread_id uuid;
begin
  if not exists (
    select 1 from public.os_room_members m
    where m.room_id = _room_id
      and m.merchant_id = public.current_merchant_id()
  ) then
    raise exception 'Not allowed to promote thread';
  end if;

  insert into public.os_threads(room_id, routing_target, source_message_ids, created_by_merchant_id)
  values (_room_id, _routing_target, _source_message_ids, public.current_merchant_id())
  returning id into _thread_id;

  update public.os_messages
  set thread_id = _thread_id
  where id = any(_source_message_ids)
    and room_id = _room_id;

  insert into public.os_audit_events (action, actor_merchant_id, target_id, immutable_payload)
  values ('thread_promoted', public.current_merchant_id(), _thread_id::text, jsonb_build_object('room_id', _room_id, 'source_message_ids', _source_message_ids, 'routing_target', _routing_target));

  return _thread_id;
end;
$$;

create or replace function public.os_capture_snapshot(
  _target_business_object_id uuid,
  _trigger_event text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  _room_id uuid;
  _snapshot text;
begin
  select room_id into _room_id from public.os_business_objects where id = _target_business_object_id;
  if _room_id is null then
    raise exception 'Business object not found';
  end if;

  if not exists (
    select 1 from public.os_room_members m
    where m.room_id = _room_id
      and m.merchant_id = public.current_merchant_id()
  ) then
    raise exception 'Not allowed to capture snapshot';
  end if;

  _snapshot := encode(gen_random_bytes(16), 'hex');

  update public.os_business_objects
  set state_snapshot_hash = '0x' || _snapshot,
      status = 'locked'
  where id = _target_business_object_id;

  insert into public.os_audit_events (action, actor_merchant_id, target_id, immutable_payload)
  values ('snapshot_captured', public.current_merchant_id(), _target_business_object_id::text, jsonb_build_object('trigger_event', _trigger_event, 'snapshot', '0x' || _snapshot));

  return '0x' || _snapshot;
end;
$$;

create or replace function public.os_send_notification(
  _room_id uuid,
  _message_id uuid,
  _urgency text default 'normal'
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  _sender text;
  _sender_title text;
  _body text;
  _inserted integer := 0;
  _recipient record;
  _should_skip boolean;
begin
  select sender_merchant_id, left(content, 100) into _sender, _body
  from public.os_messages
  where id = _message_id;

  if _sender is null then
    return 0;
  end if;

  select coalesce(nickname, display_name, merchant_id) into _sender_title
  from public.merchant_profiles where merchant_id = _sender
  limit 1;

  for _recipient in
    select rm.merchant_id, mp.user_id
    from public.os_room_members rm
    join public.merchant_profiles mp on mp.merchant_id = rm.merchant_id
    where rm.room_id = _room_id
      and rm.merchant_id <> _sender
  loop
    select exists (
      select 1
      from public.os_room_presence p
      where p.room_id = _room_id
        and p.merchant_id = _recipient.merchant_id
        and p.is_focused = true
        and p.last_seen_at > now() - interval '30 seconds'
    ) into _should_skip;

    if not _should_skip or _urgency = 'high' then
      insert into public.notifications (user_id, category, title, body, entity_type, entity_id, anchor_id)
      values (_recipient.user_id, 'message', coalesce(_sender_title, 'New message'), _body, 'os_room', _room_id::text, _message_id::text);
      _inserted := _inserted + 1;
    end if;
  end loop;

  return _inserted;
end;
$$;

create or replace function public.os_get_unread_counts(_merchant_id text default public.current_merchant_id())
returns table(room_id uuid, unread_count bigint)
language sql
stable
security definer
set search_path = public
as $$
  select m.room_id, count(*)::bigint as unread_count
  from public.os_messages m
  join public.os_room_members rm
    on rm.room_id = m.room_id
  where rm.merchant_id = _merchant_id
    and m.sender_merchant_id <> _merchant_id
    and m.read_at is null
    and not exists (
      select 1
      from public.os_room_presence p
      where p.room_id = m.room_id
        and p.merchant_id = _merchant_id
        and p.is_focused = true
        and p.last_seen_at > now() - interval '30 seconds'
    )
  group by m.room_id;
$$;

create or replace function public.os_on_new_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.os_audit_events (action, actor_merchant_id, target_id, immutable_payload)
  values ('message_created', new.sender_merchant_id, new.room_id::text, jsonb_build_object('message_id', new.id, 'room_id', new.room_id));

  perform public.os_send_notification(new.room_id, new.id, 'normal');
  return new;
end;
$$;

drop trigger if exists trg_os_on_new_message on public.os_messages;
create trigger trg_os_on_new_message
after insert on public.os_messages
for each row
execute function public.os_on_new_message();
