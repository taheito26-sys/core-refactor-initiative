-- A followed merchant keeps Binance's own nickname in `nick` (the poller may
-- refresh it), while the user's own name for them lives in `alias`, with any
-- other names they go by in `aka`. Editing needs an UPDATE policy, which the
-- watchlist did not have.

ALTER TABLE public.p2p_watched_merchants ADD COLUMN IF NOT EXISTS alias text;
ALTER TABLE public.p2p_watched_merchants ADD COLUMN IF NOT EXISTS aka text[] NOT NULL DEFAULT '{}';

DROP POLICY IF EXISTS "own watched merchants update" ON public.p2p_watched_merchants;
CREATE POLICY "own watched merchants update" ON public.p2p_watched_merchants
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
