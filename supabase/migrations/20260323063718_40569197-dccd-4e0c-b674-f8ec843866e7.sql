-- Task 3 fix: Add relationship_id and status to settlements and profits (without realtime dupe)

ALTER TABLE public.merchant_settlements
  ADD COLUMN IF NOT EXISTS relationship_id UUID REFERENCES public.merchant_relationships(id),
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending';

CREATE OR REPLACE FUNCTION public.validate_settlement_status()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status NOT IN ('pending', 'approved', 'rejected') THEN
    RAISE EXCEPTION 'Invalid settlement status: %', NEW.status;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_settlement_status ON public.merchant_settlements;
CREATE TRIGGER trg_validate_settlement_status
  BEFORE INSERT OR UPDATE ON public.merchant_settlements
  FOR EACH ROW EXECUTE FUNCTION public.validate_settlement_status();

ALTER TABLE public.merchant_profits
  ADD COLUMN IF NOT EXISTS relationship_id UUID REFERENCES public.merchant_relationships(id),
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending';

CREATE OR REPLACE FUNCTION public.validate_profit_status()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status NOT IN ('pending', 'approved', 'rejected') THEN
    RAISE EXCEPTION 'Invalid profit status: %', NEW.status;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_profit_status ON public.merchant_profits;
CREATE TRIGGER trg_validate_profit_status
  BEFORE INSERT OR UPDATE ON public.merchant_profits
  FOR EACH ROW EXECUTE FUNCTION public.validate_profit_status();

-- Backfill
UPDATE public.merchant_settlements s
SET relationship_id = d.relationship_id
FROM public.merchant_deals d
WHERE s.deal_id = d.id AND s.relationship_id IS NULL;

UPDATE public.merchant_profits p
SET relationship_id = d.relationship_id
FROM public.merchant_deals d
WHERE p.deal_id = d.id AND p.relationship_id IS NULL;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_merchant_settlements_relationship ON public.merchant_settlements (relationship_id);
CREATE INDEX IF NOT EXISTS idx_merchant_settlements_deal ON public.merchant_settlements (deal_id);
CREATE INDEX IF NOT EXISTS idx_merchant_profits_relationship ON public.merchant_profits (relationship_id);
CREATE INDEX IF NOT EXISTS idx_merchant_profits_deal ON public.merchant_profits (deal_id);