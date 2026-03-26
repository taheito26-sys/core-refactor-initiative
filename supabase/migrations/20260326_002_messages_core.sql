-- 20260326_002_messages_core.sql
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.chat_rooms(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete restrict,
  client_nonce text,
  body text not null default '',
  body_json jsonb not null default '{}'::jsonb,
  status text not null default 'sent' check (status in ('sending','sent','delivered','read','failed','deleted')),
  message_type text not null default 'text' check (message_type in ('text','reply','forward','edited','scheduled','poll','voice','system','image','vanish','file')),
  reply_to_message_id uuid references public.messages(id) on delete set null,
  legacy_source text,
  legacy_message_id text,
  deleted_for_everyone_at timestamptz,
  deleted_by uuid references auth.users(id) on delete set null,
  sent_at timestamptz not null default now(),
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_messages_room_nonce on public.messages(room_id, client_nonce) where client_nonce is not null;
create index if not exists idx_messages_room_created on public.messages(room_id, created_at desc);
create index if not exists idx_messages_room_sender_created on public.messages(room_id, sender_id, created_at desc);
create index if not exists idx_messages_status on public.messages(status);
create index if not exists idx_messages_legacy on public.messages(legacy_source, legacy_message_id);
create index if not exists idx_messages_body_search on public.messages using gin (to_tsvector('simple', coalesce(body,'')));

create table if not exists public.message_attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  room_id uuid not null references public.chat_rooms(id) on delete cascade,
  kind text not null default 'file' check (kind in ('image','video','audio','voice','file')),
  storage_bucket text,
  storage_path text,
  file_name text,
  mime_type text,
  file_size_bytes bigint,
  width int,
  height int,
  duration_seconds int,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_message_attachments_message on public.message_attachments(message_id);
create index if not exists idx_message_attachments_room on public.message_attachments(room_id, created_at desc);

alter table public.messages enable row level security;
alter table public.message_attachments enable row level security;

create table if not exists public.chat_scheduled_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.chat_rooms(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  body text not null,
  body_json jsonb not null default '{}'::jsonb,
  message_type text not null default 'scheduled',
  run_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending','sent','failed','cancelled')),
  client_nonce text,
  created_at timestamptz not null default now(),
  sent_message_id uuid references public.messages(id) on delete set null
);

create index if not exists idx_chat_scheduled_messages_due on public.chat_scheduled_messages(status, run_at);
create index if not exists idx_chat_scheduled_messages_room on public.chat_scheduled_messages(room_id, created_at desc);

create table if not exists public.chat_tracker_links (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.chat_rooms(id) on delete cascade,
  message_id uuid not null references public.messages(id) on delete cascade,
  link_type text not null check (link_type in ('order','task','reminder','cash','stock','deal')),
  linked_id text not null,
  linked_path text,
  merchant_relationship_id uuid references public.merchant_relationships(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists idx_chat_tracker_links_message on public.chat_tracker_links(message_id);
create index if not exists idx_chat_tracker_links_type on public.chat_tracker_links(link_type, linked_id);
create index if not exists idx_chat_tracker_links_room on public.chat_tracker_links(room_id, created_at desc);

alter table public.chat_scheduled_messages enable row level security;
alter table public.chat_tracker_links enable row level security;

create table if not exists public.chat_action_items (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('task','reminder','cash','stock')),
  title text not null,
  payload jsonb not null default '{}'::jsonb,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create or replace function public.fn_messages_touch() returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_messages_touch on public.messages;
create trigger trg_messages_touch
before update on public.messages
for each row execute function public.fn_messages_touch();
