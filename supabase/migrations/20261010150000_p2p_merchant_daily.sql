-- One row per followed merchant per day: the order total at the start and the
-- end of the day, kept by the poller. Orders that day = last_total - baseline_total.
-- Days are Qatar days (UTC+3, no daylight saving). Unlike the 5-minute readings,
-- these are kept long term.

CREATE TABLE IF NOT EXISTS public.p2p_merchant_daily (
  user_no text NOT NULL,
  day date NOT NULL,
  baseline_total integer,
  last_total integer,
  baseline_sell integer,
  last_sell integer,
  readings integer NOT NULL DEFAULT 0,
  online_readings integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_no, day)
);

ALTER TABLE public.p2p_merchant_daily ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "watched merchant daily select" ON public.p2p_merchant_daily;
CREATE POLICY "watched merchant daily select" ON public.p2p_merchant_daily
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.p2p_watched_merchants w
      WHERE w.user_no = p2p_merchant_daily.user_no AND w.user_id = auth.uid()
    )
  );

ALTER TABLE public.p2p_merchant_daily REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'p2p_merchant_daily'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.p2p_merchant_daily;
  END IF;
END $$;

-- Start the register from the readings already recorded.
WITH s AS (
  SELECT user_no, (ts AT TIME ZONE 'Asia/Qatar')::date AS day, ts, total_orders, sell_orders, online
  FROM public.p2p_merchant_snapshots
  WHERE total_orders IS NOT NULL
), d AS (
  SELECT user_no, day,
    (array_agg(total_orders ORDER BY ts))[1] AS first_total,
    (array_agg(total_orders ORDER BY ts DESC))[1] AS last_total,
    (array_agg(sell_orders ORDER BY ts))[1] AS first_sell,
    (array_agg(sell_orders ORDER BY ts DESC))[1] AS last_sell,
    count(*)::int AS readings,
    (count(*) FILTER (WHERE online))::int AS online_readings
  FROM s GROUP BY user_no, day
)
INSERT INTO public.p2p_merchant_daily (user_no, day, baseline_total, last_total, baseline_sell, last_sell, readings, online_readings)
SELECT user_no, day,
  COALESCE(lag(last_total) OVER (PARTITION BY user_no ORDER BY day), first_total),
  last_total,
  COALESCE(lag(last_sell) OVER (PARTITION BY user_no ORDER BY day), first_sell),
  last_sell, readings, online_readings
FROM d
ON CONFLICT (user_no, day) DO NOTHING;
