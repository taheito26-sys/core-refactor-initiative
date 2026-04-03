
CREATE TABLE IF NOT EXISTS public.capital_transfers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    deal_id UUID REFERENCES public.merchant_deals(id) ON DELETE SET NULL,
    relationship_id UUID NOT NULL REFERENCES public.merchant_relationships(id) ON DELETE CASCADE,
    direction TEXT NOT NULL CHECK (direction IN ('lender_to_operator', 'operator_to_lender')),
    amount NUMERIC NOT NULL,
    cost_basis NUMERIC NOT NULL DEFAULT 0,
    total_cost NUMERIC NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'USDT',
    transferred_by UUID NOT NULL,
    note TEXT
);

ALTER TABLE public.capital_transfers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ct_select" ON public.capital_transfers
  FOR SELECT USING (public.is_relationship_member(relationship_id));

CREATE POLICY "ct_insert" ON public.capital_transfers
  FOR INSERT WITH CHECK (
    public.is_relationship_member(relationship_id)
    AND auth.uid() = transferred_by
  );

CREATE INDEX idx_ct_relationship ON public.capital_transfers(relationship_id);
CREATE INDEX idx_ct_deal ON public.capital_transfers(deal_id);
