-- Schedule P2P scraper to run every 5 minutes to keep market data fresh.
-- Requires: pg_cron + pg_net extensions (already enabled in prior migration),
-- and a database-level setting `app.settings.service_role_key` holding the
-- Supabase service-role JWT. Set once per environment with:
--   ALTER DATABASE postgres SET app.settings.service_role_key = '<SERVICE_ROLE_KEY>';

-- Remove any existing p2p-scraper cron job to avoid duplicates
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'p2p-scraper-every-5min') THEN
    PERFORM cron.unschedule('p2p-scraper-every-5min');
  END IF;
END $$;

-- Schedule p2p-cron edge function every 5 minutes
SELECT cron.schedule(
  'p2p-scraper-every-5min',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://uqinpckirpatvkxyizqf.supabase.co/functions/v1/p2p-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  ) AS request_id;
  $$
);
