-- Keep merchant-facing customer labels available through the connection row itself.
-- Merchants can already read customer_merchant_connections; this avoids depending on
-- direct customer profile reads in the UI.

CREATE OR REPLACE FUNCTION public.sync_customer_connection_nickname()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _display_name text;
BEGIN
  IF NEW.nickname IS NOT NULL AND btrim(NEW.nickname) <> '' THEN
    RETURN NEW;
  END IF;

  SELECT display_name INTO _display_name
  FROM public.customer_profiles
  WHERE user_id = NEW.customer_user_id
  LIMIT 1;

  IF _display_name IS NOT NULL AND btrim(_display_name) <> '' THEN
    NEW.nickname := _display_name;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_customer_connection_nickname ON public.customer_merchant_connections;
CREATE TRIGGER trg_sync_customer_connection_nickname
BEFORE INSERT OR UPDATE OF customer_user_id, nickname
ON public.customer_merchant_connections
FOR EACH ROW
EXECUTE FUNCTION public.sync_customer_connection_nickname();

UPDATE public.customer_merchant_connections c
SET nickname = cp.display_name
FROM public.customer_profiles cp
WHERE cp.user_id = c.customer_user_id
  AND (c.nickname IS NULL OR btrim(c.nickname) = '');

NOTIFY pgrst, 'reload schema';
