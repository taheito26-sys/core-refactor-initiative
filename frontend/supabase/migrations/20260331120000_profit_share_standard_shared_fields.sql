-- Add shared invested capital + settlement way fields for all profit share agreements.
ALTER TABLE public.profit_share_agreements
  ADD COLUMN IF NOT EXISTS invested_capital numeric NULL,
  ADD COLUMN IF NOT EXISTS settlement_way text NULL CHECK (settlement_way IN ('reinvest', 'withdraw'));

-- Backfill legacy operator-priority rows using existing contribution data/default handling.
UPDATE public.profit_share_agreements
SET
  invested_capital = COALESCE(invested_capital, COALESCE(operator_contribution, 0) + COALESCE(lender_contribution, 0)),
  settlement_way = COALESCE(settlement_way, operator_default_profit_handling)
WHERE agreement_type = 'operator_priority';

COMMENT ON COLUMN public.profit_share_agreements.invested_capital IS 'Shared invested capital field for standard and operator-priority agreements.';
COMMENT ON COLUMN public.profit_share_agreements.settlement_way IS 'Settlement handling way for agreement-level defaults (reinvest or withdraw).';
