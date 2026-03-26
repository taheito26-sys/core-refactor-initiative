-- 20260326_004_room_policies_and_retention.sql
create table if not exists public.room_security_policies (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.chat_rooms(id) on delete cascade,
  disable_forward boolean not null default false,
  disable_copy boolean not null default false,
  disable_export boolean not null default false,
  disable_attachment_download boolean not null default false,
  restricted_badge boolean not null default false,
  watermark_label text,
  watermark_enabled boolean not null default false,
  updated_by uuid not null references auth.users(id) on delete restrict,
  updated_at timestamptz not null default now(),
  unique (room_id)
);

create table if not exists public.message_retention_policies (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.chat_rooms(id) on delete cascade,
  retention_mode text not null default 'keep' check (retention_mode in ('keep','ttl')),
  retention_ttl_seconds int,
  default_vanish_ttl_seconds int,
  updated_by uuid not null references auth.users(id) on delete restrict,
  updated_at timestamptz not null default now(),
  unique (room_id)
);

create index if not exists idx_room_security_policies_room on public.room_security_policies(room_id);
create index if not exists idx_retention_policies_room on public.message_retention_policies(room_id);

alter table public.room_security_policies enable row level security;
alter table public.message_retention_policies enable row level security;
