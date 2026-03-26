-- 20260326_009_legacy_chat_migration.sql
-- Create room rows for active relationships if missing (idempotent)
insert into public.chat_rooms (kind, title, relationship_id, owner_user_id, created_by, metadata)
select
  'direct',
  coalesce(a.display_name, mr.merchant_a_id) || ' / ' || coalesce(b.display_name, mr.merchant_b_id),
  mr.id,
  coalesce(a.user_id, b.user_id),
  coalesce(a.user_id, b.user_id),
  jsonb_build_object('legacy_source', 'merchant_relationships', 'migrated_from', 'merchant_messages')
from public.merchant_relationships mr
left join public.merchant_profiles a on a.merchant_id = mr.merchant_a_id
left join public.merchant_profiles b on b.merchant_id = mr.merchant_b_id
where not exists (select 1 from public.chat_rooms cr where cr.relationship_id = mr.id);

-- Ensure members exist for legacy direct rooms
insert into public.room_members (room_id, user_id, role)
select cr.id, mp.user_id,
  case when mp.merchant_id = mr.merchant_a_id then 'owner' else 'member' end
from public.chat_rooms cr
join public.merchant_relationships mr on mr.id = cr.relationship_id
join public.merchant_profiles mp on mp.merchant_id in (mr.merchant_a_id, mr.merchant_b_id)
on conflict (room_id, user_id) do nothing;

-- migrate old rows into canonical schema (live mode)
select public.fn_chat_migrate_legacy_messages(false);

-- enable realtime on canonical tables (idempotent)
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname='public' and tablename='messages') then
    alter publication supabase_realtime add table public.messages;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname='public' and tablename='message_reactions') then
    alter publication supabase_realtime add table public.message_reactions;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname='public' and tablename='message_pins') then
    alter publication supabase_realtime add table public.message_pins;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname='public' and tablename='message_reads') then
    alter publication supabase_realtime add table public.message_reads;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname='public' and tablename='typing_presence') then
    alter publication supabase_realtime add table public.typing_presence;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname='public' and tablename='call_sessions') then
    alter publication supabase_realtime add table public.call_sessions;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname='public' and tablename='call_events') then
    alter publication supabase_realtime add table public.call_events;
  end if;
end $$;
