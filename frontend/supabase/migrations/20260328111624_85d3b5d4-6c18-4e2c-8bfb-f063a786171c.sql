
-- Add columns for operator_priority_profit_share agreement type
-- These columns are nullable so existing agreements are unaffected

ALTER TABLE public.profit_share_agreements
  ADD COLUMN IF NOT EXISTS agreement_type text NOT NULL DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS operator_ratio numeric NULL,
  ADD COLUMN IF NOT EXISTS operator_merchant_id text NULL,
  ADD COLUMN IF NOT EXISTS operator_contribution numeric NULL,
  ADD COLUMN IF NOT EXISTS lender_contribution numeric NULL,
  ADD COLUMN IF NOT EXISTS terms_snapshot jsonb NULL;

-- Add comment for clarity
COMMENT ON COLUMN public.profit_share_agreements.agreement_type IS 'standard or operator_priority';
COMMENT ON COLUMN public.profit_share_agreements.operator_ratio IS 'Operator fee percentage (0-100), used only for operator_priority type';
COMMENT ON COLUMN public.profit_share_agreements.operator_merchant_id IS 'Merchant ID of the operator, used only for operator_priority type';
COMMENT ON COLUMN public.profit_share_agreements.operator_contribution IS 'Capital contribution of the operator, used only for operator_priority type';
COMMENT ON COLUMN public.profit_share_agreements.lender_contribution IS 'Capital contribution of the lender/partner, used only for operator_priority type';
COMMENT ON COLUMN public.profit_share_agreements.terms_snapshot IS 'Immutable snapshot of agreement terms at creation time';

NOTIFY pgrst, 'reload schema';
