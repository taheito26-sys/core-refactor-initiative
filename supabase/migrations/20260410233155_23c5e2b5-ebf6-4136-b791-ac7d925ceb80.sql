
CREATE OR REPLACE FUNCTION public.fn_auto_pause_listing_on_trade_complete()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.status = 'completed' AND OLD.status != 'completed' AND NEW.listing_id IS NOT NULL THEN
    UPDATE public.otc_listings
      SET status = 'paused', updated_at = now()
      WHERE id = NEW.listing_id AND status = 'active';
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_auto_pause_listing_on_complete
  AFTER UPDATE ON public.otc_trades
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_auto_pause_listing_on_trade_complete();
