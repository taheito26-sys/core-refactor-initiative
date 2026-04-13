
-- ============================================================
-- Settlement System — Full Schema
-- ============================================================

-- 1. Settlement periods table
CREATE TABLE IF NOT EXISTS public.settlement_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES public.merchant_deals(id) ON DELETE CASCADE,
  relationship_id UUID NOT NULL REFERENCES public.merchant_relationships(id),
  
  cadence TEXT NOT NULL,
  period_key TEXT NOT NULL,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  
  trade_count INT NOT NULL DEFAULT 0,
  gross_volume DECIMAL NOT NULL DEFAULT 0,
  total_cost DECIMAL NOT NULL DEFAULT 0,
  net_profit DECIMAL NOT NULL DEFAULT 0,
  total_fees DECIMAL NOT NULL DEFAULT 0,
  
  partner_amount DECIMAL NOT NULL DEFAULT 0,
  merchant_amount DECIMAL NOT NULL DEFAULT 0,
  
  status TEXT NOT NULL DEFAULT 'pending',
  settled_amount DECIMAL NOT NULL DEFAULT 0,
  settlement_id UUID REFERENCES public.merchant_settlements(id),
  
  resolution TEXT,
  resolved_by UUID,
  resolved_at TIMESTAMPTZ,
  
  due_at TIMESTAMPTZ,
  settled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  UNIQUE(deal_id, period_key)
);

-- Validation triggers instead of CHECK constraints
CREATE OR REPLACE FUNCTION public.validate_settlement_period_cadence()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.cadence NOT IN ('per_order', 'weekly', 'monthly') THEN
    RAISE EXCEPTION 'Invalid cadence: %', NEW.cadence;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_settlement_period_cadence
  BEFORE INSERT OR UPDATE ON public.settlement_periods
  FOR EACH ROW EXECUTE FUNCTION public.validate_settlement_period_cadence();

CREATE OR REPLACE FUNCTION public.validate_settlement_period_status()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.status NOT IN ('pending', 'due', 'overdue', 'settled', 'disputed') THEN
    RAISE EXCEPTION 'Invalid settlement period status: %', NEW.status;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_settlement_period_status
  BEFORE INSERT OR UPDATE ON public.settlement_periods
  FOR EACH ROW EXECUTE FUNCTION public.validate_settlement_period_status();

CREATE OR REPLACE FUNCTION public.validate_settlement_period_resolution()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.resolution IS NOT NULL AND NEW.resolution NOT IN ('payout', 'reinvest') THEN
    RAISE EXCEPTION 'Invalid resolution: %', NEW.resolution;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_settlement_period_resolution
  BEFORE INSERT OR UPDATE ON public.settlement_periods
  FOR EACH ROW EXECUTE FUNCTION public.validate_settlement_period_resolution();

ALTER TABLE public.settlement_periods ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Relationship members can view settlement periods"
  ON public.settlement_periods FOR SELECT
  USING (public.is_relationship_member(relationship_id));

CREATE POLICY "Relationship members can insert settlement periods"
  ON public.settlement_periods FOR INSERT
  WITH CHECK (public.is_relationship_member(relationship_id));

CREATE POLICY "Relationship members can update settlement periods"
  ON public.settlement_periods FOR UPDATE
  USING (public.is_relationship_member(relationship_id));

CREATE POLICY "Admins can view all settlement periods"
  ON public.settlement_periods FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX idx_settlement_periods_deal ON public.settlement_periods (deal_id);
CREATE INDEX idx_settlement_periods_relationship ON public.settlement_periods (relationship_id);
CREATE INDEX idx_settlement_periods_status ON public.settlement_periods (status);
CREATE INDEX idx_settlement_periods_due ON public.settlement_periods (due_at) WHERE status IN ('pending', 'due', 'overdue');

CREATE TRIGGER update_settlement_periods_updated_at
  BEFORE UPDATE ON public.settlement_periods
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. Deal capital ledger
CREATE TABLE IF NOT EXISTS public.deal_capital_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES public.merchant_deals(id) ON DELETE CASCADE,
  relationship_id UUID NOT NULL REFERENCES public.merchant_relationships(id),
  
  type TEXT NOT NULL,
  amount DECIMAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USDT',
  
  period_id UUID REFERENCES public.settlement_periods(id),
  initiated_by UUID NOT NULL,
  note TEXT,
  
  pool_balance_after DECIMAL NOT NULL DEFAULT 0,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.validate_capital_ledger_type()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.type NOT IN ('reinvest', 'withdrawal', 'payout') THEN
    RAISE EXCEPTION 'Invalid capital ledger type: %', NEW.type;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_capital_ledger_type
  BEFORE INSERT OR UPDATE ON public.deal_capital_ledger
  FOR EACH ROW EXECUTE FUNCTION public.validate_capital_ledger_type();

ALTER TABLE public.deal_capital_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Relationship members can view capital ledger"
  ON public.deal_capital_ledger FOR SELECT
  USING (public.is_relationship_member(relationship_id));

CREATE POLICY "Relationship members can insert capital entries"
  ON public.deal_capital_ledger FOR INSERT
  WITH CHECK (public.is_relationship_member(relationship_id) AND auth.uid() = initiated_by);

CREATE POLICY "Admins can view all capital ledger"
  ON public.deal_capital_ledger FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX idx_capital_ledger_deal ON public.deal_capital_ledger (deal_id);
CREATE INDEX idx_capital_ledger_relationship ON public.deal_capital_ledger (relationship_id);

-- 3. Add settlement_cadence to merchant_deals
ALTER TABLE public.merchant_deals
  ADD COLUMN IF NOT EXISTS settlement_cadence TEXT DEFAULT 'monthly';

-- 4. Helper function: get current reinvested pool balance for a deal
CREATE OR REPLACE FUNCTION public.deal_reinvested_pool(_deal_id UUID)
RETURNS DECIMAL
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT pool_balance_after 
     FROM public.deal_capital_ledger 
     WHERE deal_id = _deal_id 
     ORDER BY created_at DESC 
     LIMIT 1),
    0
  )
$$;

-- 5. Enable realtime for settlement_periods
ALTER PUBLICATION supabase_realtime ADD TABLE public.settlement_periods;
