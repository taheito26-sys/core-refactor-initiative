
-- Add invested_capital and settlement_way columns
ALTER TABLE public.profit_share_agreements
  ADD COLUMN IF NOT EXISTS invested_capital NUMERIC DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS settlement_way TEXT DEFAULT NULL;

-- Update default status from 'approved' to 'pending'
ALTER TABLE public.profit_share_agreements
  ALTER COLUMN status SET DEFAULT 'pending';

-- Update status check to include 'pending'
ALTER TABLE public.profit_share_agreements
  DROP CONSTRAINT IF EXISTS profit_share_agreements_status_check;

-- Add validation trigger for status instead of check constraint
CREATE OR REPLACE FUNCTION public.validate_psa_status()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.status NOT IN ('pending', 'approved', 'rejected', 'expired') THEN
    RAISE EXCEPTION 'Invalid agreement status: %', NEW.status;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_psa_status ON public.profit_share_agreements;
CREATE TRIGGER trg_validate_psa_status
  BEFORE INSERT OR UPDATE ON public.profit_share_agreements
  FOR EACH ROW EXECUTE FUNCTION public.validate_psa_status();

-- Add validation trigger for settlement_way
CREATE OR REPLACE FUNCTION public.validate_psa_settlement_way()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.settlement_way IS NOT NULL AND NEW.settlement_way NOT IN ('reinvest', 'withdraw') THEN
    RAISE EXCEPTION 'Invalid settlement_way: %', NEW.settlement_way;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_psa_settlement_way ON public.profit_share_agreements;
CREATE TRIGGER trg_validate_psa_settlement_way
  BEFORE INSERT OR UPDATE ON public.profit_share_agreements
  FOR EACH ROW EXECUTE FUNCTION public.validate_psa_settlement_way();

-- Refresh PostgREST schema cache
NOTIFY pgrst, 'reload schema';
