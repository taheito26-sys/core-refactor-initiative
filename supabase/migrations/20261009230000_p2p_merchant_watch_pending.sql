-- A merchant whose name Binance masks ("Jos***") and who has no ad listed
-- cannot be identified yet. Keep the request on the watchlist and let the
-- poller identify them as soon as they list an ad.

ALTER TABLE public.p2p_watched_merchants ALTER COLUMN user_no DROP NOT NULL;
ALTER TABLE public.p2p_watched_merchants ADD COLUMN IF NOT EXISTS pending_query text;
ALTER TABLE public.p2p_watched_merchants ADD COLUMN IF NOT EXISTS adv_nos text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.p2p_watched_merchants ADD COLUMN IF NOT EXISTS fiats text[] NOT NULL DEFAULT '{}';
