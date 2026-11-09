-- The merchant tracker poll ran every minute and piled up on a struggling database
-- (115 failed runs in 3 hours, 20261109 outage). Poll every 30 minutes instead.
-- The job is renamed so its name still matches its schedule.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'p2p-merchant-tracker-1min') THEN
    PERFORM cron.unschedule('p2p-merchant-tracker-1min');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'p2p-merchant-tracker-30min') THEN
    PERFORM cron.unschedule('p2p-merchant-tracker-30min');
  END IF;
END $$;

SELECT cron.schedule(
  'p2p-merchant-tracker-30min',
  '*/30 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://uqinpckirpatvkxyizqf.supabase.co/functions/v1/p2p-merchant-tracker',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := '{"action":"poll-all"}'::jsonb,
    timeout_milliseconds := 50000
  ) AS request_id;
  $$
);
