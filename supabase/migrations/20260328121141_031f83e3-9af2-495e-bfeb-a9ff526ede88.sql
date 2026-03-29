
-- Add default profit handling preferences to operator priority agreements
ALTER TABLE public.profit_share_agreements
  ADD COLUMN IF NOT EXISTS operator_default_profit_handling text NOT NULL DEFAULT 'reinvest',
  ADD COLUMN IF NOT EXISTS counterparty_default_profit_handling text NOT NULL DEFAULT 'withdraw';

-- Settlement decisions table: per-merchant, per-period monthly profit handling decisions
CREATE TABLE public.settlement_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_period_id uuid NOT NULL REFERENCES public.settlement_periods(id),
  agreement_id uuid NOT NULL REFERENCES public.profit_share_agreements(id),
  merchant_id text NOT NULL,
  role text NOT NULL DEFAULT 'participant',
  profit_amount numeric NOT NULL DEFAULT 0,
  decision text NOT NULL DEFAULT 'pending',
  default_behavior text NOT NULL DEFAULT 'withdraw',
  decision_due_at timestamptz,
  decision_confirmed_at timestamptz,
  reinvested_amount numeric NOT NULL DEFAULT 0,
  withdrawn_amount numeric NOT NULL DEFAULT 0,
  effective_capital_before numeric NOT NULL DEFAULT 0,
  effective_capital_after numeric NOT NULL DEFAULT 0,
  finalization_snapshot jsonb,
  finalized_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (settlement_period_id, merchant_id)
);

-- Validation trigger for decision values
CREATE OR REPLACE FUNCTION public.validate_settlement_decision()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.decision NOT IN ('pending', 'reinvest', 'withdraw') THEN
    RAISE EXCEPTION 'Invalid settlement decision: %', NEW.decision;
  END IF;
  IF NEW.default_behavior NOT IN ('reinvest', 'withdraw') THEN
    RAISE EXCEPTION 'Invalid default behavior: %', NEW.default_behavior;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_settlement_decision
  BEFORE INSERT OR UPDATE ON public.settlement_decisions
  FOR EACH ROW EXECUTE FUNCTION public.validate_settlement_decision();

-- Updated_at trigger
CREATE TRIGGER trg_settlement_decisions_updated_at
  BEFORE UPDATE ON public.settlement_decisions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- RLS
ALTER TABLE public.settlement_decisions ENABLE ROW LEVEL SECURITY;

-- Members of the agreement's relationship can view
CREATE POLICY sd_select ON public.settlement_decisions
  FOR SELECT TO public
  USING (
    EXISTS (
      SELECT 1 FROM public.profit_share_agreements psa
      WHERE psa.id = settlement_decisions.agreement_id
        AND is_relationship_member(psa.relationship_id)
    )
  );

-- Members can insert decisions
CREATE POLICY sd_insert ON public.settlement_decisions
  FOR INSERT TO public
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profit_share_agreements psa
      WHERE psa.id = settlement_decisions.agreement_id
        AND is_relationship_member(psa.relationship_id)
    )
  );

-- Members can update their own decisions (or system can update any)
CREATE POLICY sd_update ON public.settlement_decisions
  FOR UPDATE TO public
  USING (
    EXISTS (
      SELECT 1 FROM public.profit_share_agreements psa
      WHERE psa.id = settlement_decisions.agreement_id
        AND is_relationship_member(psa.relationship_id)
    )
  );

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.settlement_decisions;

-- Reload schema cache
NOTIFY pgrst, 'reload schema';
