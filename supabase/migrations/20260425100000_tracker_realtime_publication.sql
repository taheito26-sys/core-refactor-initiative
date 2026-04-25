-- Enable realtime for tracker_snapshots, cash_accounts, cash_ledger.
-- Without these the .on('postgres_changes', ...) listeners in
-- useTrackerState never fire and stock/cash only sync after a manual reload.

ALTER TABLE public.tracker_snapshots REPLICA IDENTITY FULL;
ALTER TABLE public.cash_accounts REPLICA IDENTITY FULL;
ALTER TABLE public.cash_ledger REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'tracker_snapshots'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.tracker_snapshots;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'cash_accounts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.cash_accounts;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'cash_ledger'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.cash_ledger;
  END IF;
END $$;
