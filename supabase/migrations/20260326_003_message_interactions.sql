-- 20260326_003_message_interactions.sql
create table if not exists public.message_reactions (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.chat_rooms(id) on delete cascade,
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  reaction text not null,
  created_at timestamptz not null default now(),
  unique (message_id, user_id, reaction)
);

create table if not exists public.message_reads (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.chat_rooms(id) on delete cascade,
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  read_at timestamptz not null default now(),
  unique (message_id, user_id)
);

create table if not exists public.message_edits (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.chat_rooms(id) on delete cascade,
  message_id uuid not null references public.messages(id) on delete cascade,
  editor_id uuid not null references auth.users(id) on delete restrict,
  old_body text,
  new_body text,
  old_body_json jsonb,
  new_body_json jsonb,
  edited_at timestamptz not null default now()
);

create table if not exists public.message_pins (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.chat_rooms(id) on delete cascade,
  message_id uuid not null references public.messages(id) on delete cascade,
  pinned_by uuid not null references auth.users(id) on delete restrict,
  pinned_at timestamptz not null default now(),
  unpinned_at timestamptz,
  unpinned_by uuid references auth.users(id) on delete set null,
  unique (room_id, message_id)
);

create table if not exists public.message_mentions (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.chat_rooms(id) on delete cascade,
  message_id uuid not null references public.messages(id) on delete cascade,
  mentioned_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (message_id, mentioned_user_id)
);

create table if not exists public.typing_presence (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.chat_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  is_typing boolean not null default true,
  expires_at timestamptz not null default (now() + interval '8 seconds'),
  updated_at timestamptz not null default now(),
  unique (room_id, user_id)
);

create index if not exists idx_message_reactions_room_message on public.message_reactions(room_id, message_id);
create index if not exists idx_message_reads_room_user on public.message_reads(room_id, user_id, read_at desc);
create index if not exists idx_message_reads_unread_probe on public.message_reads(user_id, message_id);
create index if not exists idx_message_edits_message on public.message_edits(message_id, edited_at desc);
create index if not exists idx_message_pins_room on public.message_pins(room_id, pinned_at desc) where unpinned_at is null;
create index if not exists idx_message_mentions_user on public.message_mentions(mentioned_user_id, created_at desc);
create index if not exists idx_typing_presence_room on public.typing_presence(room_id, expires_at desc);

alter table public.message_reactions enable row level security;
alter table public.message_reads enable row level security;
alter table public.message_edits enable row level security;
alter table public.message_pins enable row level security;
alter table public.message_mentions enable row level security;
alter table public.typing_presence enable row level security;
