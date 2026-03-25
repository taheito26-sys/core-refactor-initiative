
CREATE OR REPLACE FUNCTION public.auto_expire_agreements()
RETURNS TRIGGER LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.expires_at IS NOT NULL AND NEW.expires_at < NOW() AND NEW.status = 'approved' THEN
    NEW.status := 'expired';
  END IF;
  RETURN NEW;
END;
$$;
