-- Capital Transfers table for tracking pure USDT capital movements between operator and lender
-- These are distinct from settlement periods: no profit sharing, no periodic cadence.

CREATE TABLE IF NOT EXISTS public.capital_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES public.merchant_deals(id) ON DELETE CASCADE,
  relationship_id UUID NOT NULL REFERENCES public.merchant_relationships(id),

  direction TEXT NOT NULL CHECK (direction IN ('lender_to_operator', 'operator_to_lender')),
  amount DECIMAL NOT NULL,              -- USDT amount
  cost_basis DECIMAL NOT NULL,          -- QAR per USDT at time of transfer
  total_cost DECIMAL NOT NULL,          -- amount * cost_basis (in QAR)
  currency TEXT NOT NULL DEFAULT 'USDT',

  transferred_by UUID NOT NULL REFERENCES auth.users(id),
  note TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.capital_transfers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Relationship members can view capital transfers"
  ON public.capital_transfers FOR SELECT
  USING (public.is_relationship_member(relationship_id));

CREATE POLICY "Relationship members can create capital transfers"
  ON public.capital_transfers FOR INSERT
  WITH CHECK (public.is_relationship_member(relationship_id) AND auth.uid() = transferred_by);

CREATE INDEX idx_capital_transfers_deal ON public.capital_transfers (deal_id);
CREATE INDEX idx_capital_transfers_relationship ON public.capital_transfers (relationship_id);
