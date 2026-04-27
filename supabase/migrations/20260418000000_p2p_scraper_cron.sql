-- Schedule P2P scraper to run every 5 minutes to keep market data fresh.
-- Uses direct HTTP call to p2p-cron function with service role key
-- stored in Supabase environment variables (SUPABASE_SERVICE_ROLE_KEY).
--
-- IMPORTANT: Set SUPABASE_SERVICE_ROLE_KEY in Supabase Dashboard:
--   Settings > Environment Variables > Add Variable
--   Name: SUPABASE_SERVICE_ROLE_KEY
--   Value: <your-service-role-jwt>
--
-- Remove any existing p2p-scraper cron job to avoid duplicates
DO $
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'p2p-scraper-every-5min') THEN
    PERFORM cron.unschedule('p2p-scraper-every-5min');
  END IF;
END $;

-- Schedule p2p-cron edge function every 5 minutes
-- The p2p-cron function reads SUPABASE_SERVICE_ROLE_KEY from environment
SELECT cron.schedule(
  'p2p-scraper-every-5min',
  '*/5 * * * *',
  $
  SELECT net.http_post(
    url := 'https://uqinpckirpatvkxyizqf.supabase.co/functions/v1/p2p-cron',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  ) AS request_id;
  $
);
