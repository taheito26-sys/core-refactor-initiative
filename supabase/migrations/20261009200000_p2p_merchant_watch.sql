-- Binance P2P merchant watchlist: each user picks the merchants they trade with,
-- and a poller records whether they are online and how many orders they have
-- completed, so daily order counts can be derived from the changes.

CREATE TABLE IF NOT EXISTS public.p2p_watched_merchants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  user_no text NOT NULL,
  nick text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, user_no)
);

ALTER TABLE public.p2p_watched_merchants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own watched merchants select" ON public.p2p_watched_merchants;
CREATE POLICY "own watched merchants select" ON public.p2p_watched_merchants
  FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS "own watched merchants insert" ON public.p2p_watched_merchants;
CREATE POLICY "own watched merchants insert" ON public.p2p_watched_merchants
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "own watched merchants delete" ON public.p2p_watched_merchants;
CREATE POLICY "own watched merchants delete" ON public.p2p_watched_merchants
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- Public Binance figures, one row per poll. Written only by the poller
-- (service role); a user reads the rows of merchants on their own watchlist.
CREATE TABLE IF NOT EXISTS public.p2p_merchant_snapshots (
  id bigserial PRIMARY KEY,
  user_no text NOT NULL,
  ts timestamptz NOT NULL DEFAULT now(),
  online boolean NOT NULL,
  active_seconds integer,
  last_active_at timestamptz,
  total_orders integer,
  sell_orders integer,
  buy_orders integer,
  month_orders integer,
  month_sell_orders integer,
  finish_rate numeric
);

CREATE INDEX IF NOT EXISTS p2p_merchant_snapshots_user_ts_idx
  ON public.p2p_merchant_snapshots (user_no, ts DESC);

ALTER TABLE public.p2p_merchant_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "watched merchant snapshots select" ON public.p2p_merchant_snapshots;
CREATE POLICY "watched merchant snapshots select" ON public.p2p_merchant_snapshots
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.p2p_watched_merchants w
      WHERE w.user_no = p2p_merchant_snapshots.user_no AND w.user_id = auth.uid()
    )
  );

ALTER TABLE public.p2p_merchant_snapshots REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'p2p_merchant_snapshots'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.p2p_merchant_snapshots;
  END IF;
END $$;

-- Poll every watched merchant every 5 minutes. The page also asks for a fresh
-- reading every 30 seconds while it is open.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'p2p-merchant-tracker-5min') THEN
    PERFORM cron.unschedule('p2p-merchant-tracker-5min');
  END IF;
END $$;

SELECT cron.schedule(
  'p2p-merchant-tracker-5min',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://uqinpckirpatvkxyizqf.supabase.co/functions/v1/p2p-merchant-tracker',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := '{"action":"poll-all"}'::jsonb,
    timeout_milliseconds := 50000
  ) AS request_id;
  $$
);
