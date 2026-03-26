-- 20260326_006_legacy_mapping_and_audit.sql
create table if not exists public.legacy_message_map (
  id uuid primary key default gen_random_uuid(),
  legacy_source text not null,
  legacy_message_id text not null,
  legacy_room_key text,
  room_id uuid references public.chat_rooms(id) on delete set null,
  message_id uuid references public.messages(id) on delete set null,
  migration_status text not null default 'migrated' check (migration_status in ('migrated','skipped','failed','repaired','orphaned')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (legacy_source, legacy_message_id)
);

create table if not exists public.migration_audit_log (
  id uuid primary key default gen_random_uuid(),
  migration_name text not null,
  mode text not null default 'live' check (mode in ('live','dry_run')),
  run_by uuid references auth.users(id) on delete set null,
  metrics jsonb not null default '{}'::jsonb,
  status text not null default 'ok' check (status in ('ok','warning','error')),
  details text,
  created_at timestamptz not null default now()
);

create table if not exists public.policy_audit_log (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.chat_rooms(id) on delete cascade,
  changed_by uuid not null references auth.users(id) on delete restrict,
  change_type text not null,
  old_value jsonb,
  new_value jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_legacy_message_map_room on public.legacy_message_map(room_id);
create index if not exists idx_legacy_message_map_message on public.legacy_message_map(message_id);
create index if not exists idx_legacy_message_map_status on public.legacy_message_map(migration_status);
create index if not exists idx_migration_audit_log_created on public.migration_audit_log(created_at desc);
create index if not exists idx_policy_audit_room on public.policy_audit_log(room_id, created_at desc);

alter table public.legacy_message_map enable row level security;
alter table public.migration_audit_log enable row level security;
alter table public.policy_audit_log enable row level security;
