-- 20260326_001_chat_rooms_and_members.sql
create extension if not exists pgcrypto;

create table if not exists public.chat_rooms (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'direct' check (kind in ('direct','group','system')),
  title text,
  slug text,
  relationship_id uuid references public.merchant_relationships(id) on delete set null,
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  created_by uuid not null references auth.users(id) on delete restrict,
  is_archived boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (slug)
);

create table if not exists public.room_members (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.chat_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','admin','member')),
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  notify_level text not null default 'all' check (notify_level in ('all','mentions','none')),
  last_read_message_id uuid,
  unique (room_id, user_id)
);

create index if not exists idx_chat_rooms_relationship on public.chat_rooms(relationship_id);
create index if not exists idx_chat_rooms_updated on public.chat_rooms(updated_at desc);
create index if not exists idx_room_members_user_room on public.room_members(user_id, room_id);
create index if not exists idx_room_members_room on public.room_members(room_id);

alter table public.chat_rooms enable row level security;
alter table public.room_members enable row level security;

-- keep updated_at current
create or replace function public.fn_chat_touch_room() returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_chat_rooms_touch on public.chat_rooms;
create trigger trg_chat_rooms_touch
before update on public.chat_rooms
for each row execute function public.fn_chat_touch_room();
