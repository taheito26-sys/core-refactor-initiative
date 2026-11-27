-- Binance P2P order alerts.
-- The p2p-order-watch Edge Function checks each opted-in merchant's Binance
-- account every 20 seconds for an open P2P order. A newly seen open order is
-- recorded here and pushed to the merchant's devices, then pushed again every
-- 2 minutes until the merchant acknowledges it or the order closes.

CREATE TABLE IF NOT EXISTS public.p2p_order_watch (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  last_checked_at timestamptz,
  last_ok_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.p2p_order_watch ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own p2p order watch" ON public.p2p_order_watch;
CREATE POLICY "Users manage own p2p order watch" ON public.p2p_order_watch
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP TRIGGER IF EXISTS update_p2p_order_watch_updated_at ON public.p2p_order_watch;
CREATE TRIGGER update_p2p_order_watch_updated_at BEFORE UPDATE ON public.p2p_order_watch
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.p2p_order_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  exchange text NOT NULL DEFAULT 'binance',
  order_number text NOT NULL,
  side text,
  asset text,
  fiat text,
  amount numeric,
  price numeric,
  total numeric,
  counterparty text,
  order_status text,
  order_created_at timestamptz,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_pushed_at timestamptz,
  push_count integer NOT NULL DEFAULT 0,
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  ack_token text NOT NULL DEFAULT replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  UNIQUE (user_id, exchange, order_number)
);
CREATE INDEX IF NOT EXISTS p2p_order_alerts_open_idx
  ON public.p2p_order_alerts (user_id)
  WHERE acknowledged_at IS NULL AND resolved_at IS NULL;

ALTER TABLE public.p2p_order_alerts ENABLE ROW LEVEL SECURITY;

-- Read-only for the merchant; writes come from the Edge Function (service role)
-- and from the acknowledge RPC below.
DROP POLICY IF EXISTS "Users view own p2p order alerts" ON public.p2p_order_alerts;
CREATE POLICY "Users view own p2p order alerts" ON public.p2p_order_alerts
  FOR SELECT USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.acknowledge_p2p_order_alerts(p_alert_ids uuid[] DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  UPDATE public.p2p_order_alerts
     SET acknowledged_at = now()
   WHERE user_id = auth.uid()
     AND acknowledged_at IS NULL
     AND (p_alert_ids IS NULL OR id = ANY (p_alert_ids));
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.acknowledge_p2p_order_alerts(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.acknowledge_p2p_order_alerts(uuid[]) TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'p2p_order_alerts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.p2p_order_alerts;
  END IF;
END $$;

-- The cron job only queues an async HTTP call (pg_net), so it returns at once
-- and never holds a database connection while Binance answers. Sub-minute
-- schedules need pg_cron 1.5+; an older pg_cron falls back to once a minute.
DO $$
DECLARE
  v_command text := $cmd$
  SELECT net.http_post(
    url := 'https://uqinpckirpatvkxyizqf.supabase.co/functions/v1/p2p-order-watch',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := '{"action":"poll"}'::jsonb,
    timeout_milliseconds := 15000
  ) AS request_id;
  $cmd$;
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'p2p-order-watch') THEN
    PERFORM cron.unschedule('p2p-order-watch');
  END IF;
  BEGIN
    PERFORM cron.schedule('p2p-order-watch', '20 seconds', v_command);
  EXCEPTION WHEN OTHERS THEN
    PERFORM cron.schedule('p2p-order-watch', '* * * * *', v_command);
  END;
END $$;
