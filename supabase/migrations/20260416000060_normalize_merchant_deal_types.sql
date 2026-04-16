-- Normalize legacy merchant_deals labels after the live data import has completed.

UPDATE public.merchant_deals
SET deal_type = CASE
  WHEN deal_type = 'partnership' THEN 'profit_share'
  WHEN deal_type = 'arbitrage' THEN 'investment'
  ELSE deal_type
END
WHERE deal_type IN ('partnership', 'arbitrage');

DO $$
BEGIN
  ALTER TABLE public.merchant_deals DROP CONSTRAINT IF EXISTS merchant_deals_deal_type_check;
  ALTER TABLE public.merchant_deals ADD CONSTRAINT merchant_deals_deal_type_check
    CHECK (deal_type IN ('loan', 'investment', 'general', 'capital_transfer', 'profit_share'));
EXCEPTION
  WHEN others THEN
    NULL;
END $$;
