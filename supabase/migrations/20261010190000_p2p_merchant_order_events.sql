-- Every time a followed merchant's completed-order total goes up, one event:
-- when it was noticed, the reading before it, and how many orders were added.
-- Binance publishes no per-order times for other merchants, so an order's time
-- is known to within the gap between those two readings (about a minute).

CREATE TABLE IF NOT EXISTS public.p2p_merchant_order_events (
  id bigserial PRIMARY KEY,
  user_no text NOT NULL,
  detected_at timestamptz NOT NULL DEFAULT now(),
  prev_read_at timestamptz NOT NULL,
  orders integer NOT NULL,
  sells integer,
  total_after integer NOT NULL
);

CREATE INDEX IF NOT EXISTS p2p_merchant_order_events_user_idx
  ON public.p2p_merchant_order_events (user_no, detected_at DESC);

ALTER TABLE public.p2p_merchant_order_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "watched merchant events select" ON public.p2p_merchant_order_events;
CREATE POLICY "watched merchant events select" ON public.p2p_merchant_order_events
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.p2p_watched_merchants w
      WHERE w.user_no = p2p_merchant_order_events.user_no AND w.user_id = auth.uid()
    )
  );

ALTER TABLE public.p2p_merchant_order_events REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'p2p_merchant_order_events'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.p2p_merchant_order_events;
  END IF;
END $$;

-- Events from the readings already recorded.
INSERT INTO public.p2p_merchant_order_events (user_no, detected_at, prev_read_at, orders, sells, total_after)
SELECT user_no, ts, prev_ts, total_orders - prev_total,
       CASE WHEN sell_orders IS NOT NULL AND prev_sell IS NOT NULL THEN GREATEST(0, sell_orders - prev_sell) END,
       total_orders
FROM (
  SELECT user_no, ts, total_orders, sell_orders,
         lag(ts) OVER w AS prev_ts, lag(total_orders) OVER w AS prev_total, lag(sell_orders) OVER w AS prev_sell
  FROM public.p2p_merchant_snapshots
  WHERE total_orders IS NOT NULL
  WINDOW w AS (PARTITION BY user_no ORDER BY ts)
) t
WHERE prev_total IS NOT NULL AND total_orders > prev_total
  AND NOT EXISTS (SELECT 1 FROM public.p2p_merchant_order_events e WHERE e.user_no = t.user_no AND e.detected_at = t.ts);

-- Check every minute (was every 5) so an order's time is known more closely.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'p2p-merchant-tracker-5min') THEN
    PERFORM cron.unschedule('p2p-merchant-tracker-5min');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'p2p-merchant-tracker-1min') THEN
    PERFORM cron.unschedule('p2p-merchant-tracker-1min');
  END IF;
END $$;

SELECT cron.schedule(
  'p2p-merchant-tracker-1min',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://uqinpckirpatvkxyizqf.supabase.co/functions/v1/p2p-merchant-tracker',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := '{"action":"poll-all"}'::jsonb,
    timeout_milliseconds := 50000
  ) AS request_id;
  $$
);
