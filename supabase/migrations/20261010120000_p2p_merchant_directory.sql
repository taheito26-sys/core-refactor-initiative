-- Binance does not reveal a merchant's id from the masked name in order
-- history, only while they have an ad listed. The tracker records every ad it
-- sees (ad number, merchant id, nickname), so a merchant who has advertised
-- while it was recording can be identified later without waiting for a new ad.
-- Public Binance data; written and read only by the tracker (service role).

CREATE TABLE IF NOT EXISTS public.p2p_merchant_ads (
  adv_no text PRIMARY KEY,
  user_no text NOT NULL,
  nick text NOT NULL,
  month_orders integer,
  last_seen timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS p2p_merchant_ads_user_idx ON public.p2p_merchant_ads (user_no);
CREATE INDEX IF NOT EXISTS p2p_merchant_ads_nick_idx ON public.p2p_merchant_ads (lower(nick) text_pattern_ops);

ALTER TABLE public.p2p_merchant_ads ENABLE ROW LEVEL SECURITY;
