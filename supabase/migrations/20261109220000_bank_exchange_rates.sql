-- Live Bank Misr rate shown to customers (QAR notes). One row per bank/currency/product,
-- refreshed by the bank-misr-rates edge function every 30 minutes.
CREATE TABLE IF NOT EXISTS public.bank_exchange_rates (
  bank        text        NOT NULL,
  currency    text        NOT NULL,
  product     text        NOT NULL,
  buy         numeric     NOT NULL,
  sell        numeric     NOT NULL,
  fetched_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (bank, currency, product)
);

ALTER TABLE public.bank_exchange_rates ENABLE ROW LEVEL SECURITY;

-- Public market data: any signed-in user (customer or merchant) may read it. Writes happen
-- only through the edge function's service role, which bypasses RLS.
DROP POLICY IF EXISTS "Signed-in users read bank rates" ON public.bank_exchange_rates;
CREATE POLICY "Signed-in users read bank rates" ON public.bank_exchange_rates
  FOR SELECT TO authenticated USING (true);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'bank-misr-rates-30min') THEN
    PERFORM cron.unschedule('bank-misr-rates-30min');
  END IF;
END $$;

SELECT cron.schedule(
  'bank-misr-rates-30min',
  '*/30 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://uqinpckirpatvkxyizqf.supabase.co/functions/v1/bank-misr-rates',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  ) AS request_id;
  $$
);
