create extension if not exists pgcrypto;

create table if not exists public.os_rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null check (type in ('standard', 'broadcast', 'approval', 'incident', 'deal', 'temporary')),
  lane text not null check (lane in ('Personal', 'Team', 'Customers', 'Deals', 'Alerts', 'Archived')),
  security_policies jsonb not null default jsonb_build_object(
    'disable_forwarding', false,
    'disable_copy', false,
    'disable_export', false,
    'watermark', false
  ),
  retention_policy text not null default 'indefinite' check (retention_policy in ('indefinite', '30d', '7d', '24h', 'view_once')),
  created_by text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.os_room_members (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.os_rooms(id) on delete cascade,
  merchant_id text not null,
  role text not null default 'member' check (role in ('owner', 'member', 'observer')),
  joined_at timestamptz not null default now(),
  unique (room_id, merchant_id)
);

create table if not exists public.os_channel_identities (
  id uuid primary key default gen_random_uuid(),
  merchant_id text not null,
  provider_type text not null check (provider_type in ('WhatsApp', 'Web', 'Telegram', 'Email', 'SMS')),
  provider_uid text not null,
  confidence_level text not null default 'certain' check (confidence_level in ('certain', 'probable', 'unresolved')),
  created_at timestamptz not null default now(),
  unique (merchant_id, provider_type, provider_uid)
);

create table if not exists public.os_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.os_rooms(id) on delete cascade,
  thread_id uuid null,
  sender_merchant_id text not null,
  sender_identity_id uuid null references public.os_channel_identities(id) on delete set null,
  content text not null,
  permissions jsonb not null default jsonb_build_object(
    'forwardable', true,
    'exportable', true,
    'copyable', true,
    'ai_readable', true
  ),
  expires_at timestamptz null,
  retention_policy text not null default 'indefinite' check (retention_policy in ('indefinite', '30d', '7d', '24h', 'view_once')),
  view_limit integer null,
  read_at timestamptz null,
  created_at timestamptz not null default now()
);

create table if not exists public.os_business_objects (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.os_rooms(id) on delete cascade,
  object_type text not null check (object_type in ('order', 'payment', 'agreement', 'dispute', 'task', 'deal_offer', 'snapshot')),
  source_message_id uuid null references public.os_messages(id) on delete set null,
  created_by_merchant_id text not null,
  state_snapshot_hash text null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected', 'completed', 'locked')),
  created_at timestamptz not null default now()
);

create index if not exists idx_os_room_members_merchant on public.os_room_members(merchant_id);
create index if not exists idx_os_messages_room_created on public.os_messages(room_id, created_at);
create index if not exists idx_os_business_objects_room_created on public.os_business_objects(room_id, created_at);

alter table public.os_rooms enable row level security;
alter table public.os_room_members enable row level security;
alter table public.os_channel_identities enable row level security;
alter table public.os_messages enable row level security;
alter table public.os_business_objects enable row level security;

drop policy if exists "os_rooms_select_member" on public.os_rooms;
create policy "os_rooms_select_member"
on public.os_rooms
for select
to authenticated
using (
  exists (
    select 1
    from public.os_room_members m
    where m.room_id = os_rooms.id
      and m.merchant_id = public.current_merchant_id()
  )
);

drop policy if exists "os_rooms_insert_owner" on public.os_rooms;
create policy "os_rooms_insert_owner"
on public.os_rooms
for insert
to authenticated
with check (created_by = public.current_merchant_id());

drop policy if exists "os_room_members_select_member" on public.os_room_members;
create policy "os_room_members_select_member"
on public.os_room_members
for select
to authenticated
using (
  exists (
    select 1
    from public.os_room_members mine
    where mine.room_id = os_room_members.room_id
      and mine.merchant_id = public.current_merchant_id()
  )
);

drop policy if exists "os_room_members_insert_owner" on public.os_room_members;
create policy "os_room_members_insert_owner"
on public.os_room_members
for insert
to authenticated
with check (merchant_id = public.current_merchant_id());

drop policy if exists "os_channel_identities_select_member" on public.os_channel_identities;
create policy "os_channel_identities_select_member"
on public.os_channel_identities
for select
to authenticated
using (
  exists (
    select 1
    from public.os_room_members m
    where m.merchant_id = os_channel_identities.merchant_id
      and exists (
        select 1
        from public.os_room_members mine
        where mine.room_id = m.room_id
          and mine.merchant_id = public.current_merchant_id()
      )
  )
);

drop policy if exists "os_channel_identities_insert_self" on public.os_channel_identities;
create policy "os_channel_identities_insert_self"
on public.os_channel_identities
for insert
to authenticated
with check (merchant_id = public.current_merchant_id());

drop policy if exists "os_messages_select_member" on public.os_messages;
create policy "os_messages_select_member"
on public.os_messages
for select
to authenticated
using (
  exists (
    select 1
    from public.os_room_members m
    where m.room_id = os_messages.room_id
      and m.merchant_id = public.current_merchant_id()
  )
);

drop policy if exists "os_messages_insert_sender_member" on public.os_messages;
create policy "os_messages_insert_sender_member"
on public.os_messages
for insert
to authenticated
with check (
  sender_merchant_id = public.current_merchant_id()
  and exists (
    select 1
    from public.os_room_members m
    where m.room_id = os_messages.room_id
      and m.merchant_id = public.current_merchant_id()
  )
);

drop policy if exists "os_business_objects_select_member" on public.os_business_objects;
create policy "os_business_objects_select_member"
on public.os_business_objects
for select
to authenticated
using (
  exists (
    select 1
    from public.os_room_members m
    where m.room_id = os_business_objects.room_id
      and m.merchant_id = public.current_merchant_id()
  )
);

drop policy if exists "os_business_objects_insert_creator_member" on public.os_business_objects;
create policy "os_business_objects_insert_creator_member"
on public.os_business_objects
for insert
to authenticated
with check (
  created_by_merchant_id = public.current_merchant_id()
  and exists (
    select 1
    from public.os_room_members m
    where m.room_id = os_business_objects.room_id
      and m.merchant_id = public.current_merchant_id()
  )
);

drop policy if exists "os_business_objects_update_member" on public.os_business_objects;
create policy "os_business_objects_update_member"
on public.os_business_objects
for update
to authenticated
using (
  exists (
    select 1
    from public.os_room_members m
    where m.room_id = os_business_objects.room_id
      and m.merchant_id = public.current_merchant_id()
  )
)
with check (
  exists (
    select 1
    from public.os_room_members m
    where m.room_id = os_business_objects.room_id
      and m.merchant_id = public.current_merchant_id()
  )
);

with ordered_merchants as (
  select merchant_id, row_number() over (order by created_at asc) as rn
  from public.merchant_profiles
),
owner_merchant as (
  select merchant_id from ordered_merchants where rn = 1
),
peer_merchant as (
  select merchant_id from ordered_merchants where rn = 2
),
resolved as (
  select
    (select merchant_id from owner_merchant) as owner_id,
    coalesce((select merchant_id from peer_merchant), (select merchant_id from owner_merchant)) as peer_id
),
seed_rooms as (
  insert into public.os_rooms (id, name, type, lane, security_policies, retention_policy, created_by)
  select * from (
    values
      ('11111111-1111-4111-8111-111111111111'::uuid, 'Deal Negotiation: Alpha', 'deal', 'Deals', '{"disable_forwarding": true, "disable_copy": true, "disable_export": true, "watermark": true}'::jsonb, '30d', (select owner_id from resolved)),
      ('22222222-2222-4222-8222-222222222222'::uuid, 'Customer Support: 8812', 'standard', 'Customers', '{"disable_forwarding": false, "disable_copy": false, "disable_export": false, "watermark": false}'::jsonb, 'indefinite', (select owner_id from resolved))
  ) as v(id, name, type, lane, security_policies, retention_policy, created_by)
  where (select owner_id from resolved) is not null
  on conflict (id) do nothing
  returning id
)
insert into public.os_room_members (room_id, merchant_id, role)
select room_id, merchant_id, role
from (
  values
    ('11111111-1111-4111-8111-111111111111'::uuid, (select owner_id from resolved), 'owner'),
    ('11111111-1111-4111-8111-111111111111'::uuid, (select peer_id from resolved), 'member'),
    ('22222222-2222-4222-8222-222222222222'::uuid, (select owner_id from resolved), 'owner'),
    ('22222222-2222-4222-8222-222222222222'::uuid, (select peer_id from resolved), 'member')
) as v(room_id, merchant_id, role)
where merchant_id is not null
on conflict (room_id, merchant_id) do nothing;

with ordered_merchants as (
  select merchant_id, row_number() over (order by created_at asc) as rn
  from public.merchant_profiles
),
owner_merchant as (
  select merchant_id from ordered_merchants where rn = 1
),
peer_merchant as (
  select merchant_id from ordered_merchants where rn = 2
),
resolved as (
  select
    (select merchant_id from owner_merchant) as owner_id,
    coalesce((select merchant_id from peer_merchant), (select merchant_id from owner_merchant)) as peer_id
)
insert into public.os_channel_identities (id, merchant_id, provider_type, provider_uid, confidence_level)
select id, merchant_id, provider_type, provider_uid, confidence_level
from (
  values
    ('33333333-3333-4333-8333-333333333333'::uuid, (select owner_id from resolved), 'Web', 'owner-web', 'certain'),
    ('44444444-4444-4444-8444-444444444444'::uuid, (select peer_id from resolved), 'WhatsApp', 'peer-whatsapp', 'certain'),
    ('55555555-5555-4555-8555-555555555555'::uuid, (select peer_id from resolved), 'SMS', 'peer-sms', 'probable')
) as v(id, merchant_id, provider_type, provider_uid, confidence_level)
where merchant_id is not null
on conflict (id) do nothing;

with ordered_merchants as (
  select merchant_id, row_number() over (order by created_at asc) as rn
  from public.merchant_profiles
),
owner_merchant as (
  select merchant_id from ordered_merchants where rn = 1
),
peer_merchant as (
  select merchant_id from ordered_merchants where rn = 2
),
resolved as (
  select
    (select merchant_id from owner_merchant) as owner_id,
    coalesce((select merchant_id from peer_merchant), (select merchant_id from owner_merchant)) as peer_id
)
insert into public.os_messages (id, room_id, sender_merchant_id, sender_identity_id, content, permissions, retention_policy, created_at)
select id, room_id, sender_merchant_id, sender_identity_id, content, permissions, retention_policy, created_at
from (
  values
    (
      '66666666-6666-4666-8666-666666666666'::uuid,
      '11111111-1111-4111-8111-111111111111'::uuid,
      (select peer_id from resolved),
      '44444444-4444-4444-8444-444444444444'::uuid,
      'Here are the initial terms we requested via WhatsApp.',
      '{"forwardable": false, "exportable": false, "copyable": false, "ai_readable": false}'::jsonb,
      '30d',
      now() - interval '8 minutes'
    ),
    (
      '77777777-7777-4777-8777-777777777777'::uuid,
      '22222222-2222-4222-8222-222222222222'::uuid,
      (select peer_id from resolved),
      '55555555-5555-4555-8555-555555555555'::uuid,
      'I need tracking info please.',
      '{"forwardable": true, "exportable": true, "copyable": true, "ai_readable": true}'::jsonb,
      'indefinite',
      now() - interval '4 minutes'
    )
) as v(id, room_id, sender_merchant_id, sender_identity_id, content, permissions, retention_policy, created_at)
where sender_merchant_id is not null
on conflict (id) do nothing;

with ordered_merchants as (
  select merchant_id, row_number() over (order by created_at asc) as rn
  from public.merchant_profiles
),
peer_merchant as (
  select merchant_id from ordered_merchants where rn = 2
),
resolved as (
  select coalesce((select merchant_id from peer_merchant), (select merchant_id from ordered_merchants where rn = 1)) as peer_id
)
insert into public.os_business_objects (id, room_id, object_type, source_message_id, created_by_merchant_id, payload, status, created_at)
select id, room_id, object_type, source_message_id, created_by_merchant_id, payload, status, created_at
from (
  values
    (
      '88888888-8888-4888-8888-888888888888'::uuid,
      '11111111-1111-4111-8111-111111111111'::uuid,
      'deal_offer',
      '66666666-6666-4666-8666-666666666666'::uuid,
      (select peer_id from resolved),
      '{"amount": 50000, "asset": "USDT", "rate": 3.65}'::jsonb,
      'pending',
      now() - interval '6 minutes'
    )
) as v(id, room_id, object_type, source_message_id, created_by_merchant_id, payload, status, created_at)
where created_by_merchant_id is not null
on conflict (id) do nothing;
