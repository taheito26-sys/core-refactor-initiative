-- Change the P2P scraper schedule from every 5 minutes to once per hour.
-- Supersedes 20260418000000_p2p_scraper_cron.sql. The old job name is
-- unscheduled first so the two schedules cannot both fire.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'p2p-scraper-every-5min') THEN
    PERFORM cron.unschedule('p2p-scraper-every-5min');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'p2p-scraper-hourly') THEN
    PERFORM cron.unschedule('p2p-scraper-hourly');
  END IF;
END $$;

SELECT cron.schedule(
  'p2p-scraper-hourly',
  '0 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://uqinpckirpatvkxyizqf.supabase.co/functions/v1/p2p-cron',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  ) AS request_id;
  $$
);
