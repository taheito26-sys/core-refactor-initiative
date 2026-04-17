-- Schedule P2P scraper to run every 5 minutes to keep market data fresh.
-- Requires: pg_cron + pg_net extensions (already enabled in prior migration),
-- and a Supabase Vault secret named 'service_role_key' containing the
-- project's service-role JWT. Create it once with:
--   SELECT vault.create_secret('<SERVICE_ROLE_JWT>', 'service_role_key');

-- Remove any existing p2p-scraper cron job to avoid duplicates
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'p2p-scraper-every-5min') THEN
    PERFORM cron.unschedule('p2p-scraper-every-5min');
  END IF;
END $$;

-- Schedule p2p-cron edge function every 5 minutes, pulling the service-role
-- key from Vault at call time so the secret never lives in plaintext SQL.
SELECT cron.schedule(
  'p2p-scraper-every-5min',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://uqinpckirpatvkxyizqf.supabase.co/functions/v1/p2p-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        SELECT decrypted_secret
        FROM vault.decrypted_secrets
        WHERE name = 'service_role_key'
        LIMIT 1
      )
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  ) AS request_id;
  $$
);
