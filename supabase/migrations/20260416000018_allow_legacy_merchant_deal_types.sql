-- Temporary compatibility shim for the Lovable export bundle.
-- The imported merchant_deals rows still use legacy labels that were
-- normalized in later migrations. Allow them during the data load, then
-- a follow-up migration will rewrite the rows and restore the stricter set.

DO $$
BEGIN
  ALTER TABLE public.merchant_deals DROP CONSTRAINT IF EXISTS merchant_deals_deal_type_check;
  ALTER TABLE public.merchant_deals ADD CONSTRAINT merchant_deals_deal_type_check
    CHECK (deal_type IN ('loan', 'investment', 'general', 'capital_transfer', 'profit_share', 'partnership', 'arbitrage'));
EXCEPTION
  WHEN others THEN
    NULL;
END $$;
