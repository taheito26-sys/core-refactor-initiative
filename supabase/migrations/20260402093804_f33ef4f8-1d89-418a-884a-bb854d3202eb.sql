-- Drop legacy ratio constraints that block operator_priority agreements
ALTER TABLE public.profit_share_agreements DROP CONSTRAINT IF EXISTS profit_share_agreements_merchant_ratio_check;
ALTER TABLE public.profit_share_agreements DROP CONSTRAINT IF EXISTS profit_share_agreements_partner_ratio_check;
ALTER TABLE public.profit_share_agreements DROP CONSTRAINT IF EXISTS valid_ratios;

-- Replace with a validation trigger that allows 0/0 for operator_priority
CREATE OR REPLACE FUNCTION public.validate_psa_ratios()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.agreement_type = 'operator_priority' THEN
    -- operator_priority agreements use 0/0 ratios; skip ratio validation
    RETURN NEW;
  END IF;

  -- Standard agreements: ratios must be > 0, < 100, and sum to 100
  IF NEW.partner_ratio <= 0 OR NEW.partner_ratio >= 100 THEN
    RAISE EXCEPTION 'partner_ratio must be between 0 and 100 (exclusive) for standard agreements';
  END IF;
  IF NEW.merchant_ratio <= 0 OR NEW.merchant_ratio >= 100 THEN
    RAISE EXCEPTION 'merchant_ratio must be between 0 and 100 (exclusive) for standard agreements';
  END IF;
  IF NEW.partner_ratio + NEW.merchant_ratio != 100 THEN
    RAISE EXCEPTION 'partner_ratio + merchant_ratio must equal 100 for standard agreements';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_psa_ratios ON public.profit_share_agreements;
CREATE TRIGGER trg_validate_psa_ratios
  BEFORE INSERT OR UPDATE ON public.profit_share_agreements
  FOR EACH ROW EXECUTE FUNCTION public.validate_psa_ratios();