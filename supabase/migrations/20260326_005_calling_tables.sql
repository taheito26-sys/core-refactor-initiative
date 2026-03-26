-- 20260326_005_calling_tables.sql
create table if not exists public.call_sessions (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.chat_rooms(id) on delete cascade,
  started_by uuid not null references auth.users(id) on delete restrict,
  status text not null default 'ringing' check (status in ('ringing','active','ended','missed','cancelled')),
  started_at timestamptz not null default now(),
  answered_at timestamptz,
  ended_at timestamptz,
  ended_by uuid references auth.users(id) on delete set null,
  ended_reason text,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.call_participants (
  id uuid primary key default gen_random_uuid(),
  call_session_id uuid not null references public.call_sessions(id) on delete cascade,
  room_id uuid not null references public.chat_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'invited' check (status in ('invited','ringing','joined','left','declined','missed','kicked')),
  joined_at timestamptz,
  left_at timestamptz,
  muted boolean not null default false,
  unique (call_session_id, user_id)
);

create table if not exists public.call_events (
  id uuid primary key default gen_random_uuid(),
  call_session_id uuid not null references public.call_sessions(id) on delete cascade,
  room_id uuid not null references public.chat_rooms(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_call_sessions_room_started on public.call_sessions(room_id, started_at desc);
create index if not exists idx_call_participants_call on public.call_participants(call_session_id);
create index if not exists idx_call_participants_user on public.call_participants(user_id, status);
create index if not exists idx_call_events_session on public.call_events(call_session_id, created_at asc);

alter table public.call_sessions enable row level security;
alter table public.call_participants enable row level security;
alter table public.call_events enable row level security;
