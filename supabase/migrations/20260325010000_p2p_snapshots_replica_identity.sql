-- ═══════════════════════════════════════════════════════════════════════
-- Enable REPLICA IDENTITY FULL on p2p_snapshots
--
-- Supabase Realtime postgres_changes subscriptions with column-level
-- filters (e.g. `market=eq.oman`) require the table to publish full
-- row data in the WAL stream.  The default REPLICA IDENTITY DEFAULT
-- only exposes the primary key, so non-PK column filters silently
-- fall through and real-time pushes never reach the client.
--
-- Safe to run multiple times.
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE public.p2p_snapshots REPLICA IDENTITY FULL;

-- Ensure the table is included in the supabase_realtime publication
-- (idempotent — safe if it's already a member)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename  = 'p2p_snapshots'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.p2p_snapshots;
  END IF;
END
$$;
