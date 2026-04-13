
-- Drop the old BEFORE trigger
DROP TRIGGER IF EXISTS trg_auto_release_escrow ON public.otc_trades;

-- Recreate the function as AFTER-compatible (no RETURN NEW needed, update escrow_status directly)
CREATE OR REPLACE FUNCTION public.fn_auto_release_escrow()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = 'completed' AND OLD.status != 'completed' THEN
    -- Release escrow deposits
    UPDATE public.otc_escrow
      SET status = 'released', released_at = now(), updated_at = now()
      WHERE trade_id = NEW.id AND status = 'deposited';
    -- Update escrow_status on the trade
    UPDATE public.otc_trades
      SET escrow_status = 'released'
      WHERE id = NEW.id;
  END IF;
  RETURN NULL;
END;
$function$;

-- Create as AFTER trigger
CREATE TRIGGER trg_auto_release_escrow
  AFTER UPDATE ON public.otc_trades
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_auto_release_escrow();
