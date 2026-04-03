-- Update merchant deal status via RPC (POST), avoiding direct PATCH dependency from web clients.
CREATE OR REPLACE FUNCTION public.set_merchant_deal_status(
  _deal_id uuid,
  _status text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF _deal_id IS NULL THEN
    RAISE EXCEPTION 'deal_id is required';
  END IF;

  IF _status IS NULL OR btrim(_status) = '' THEN
    RAISE EXCEPTION 'status is required';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.merchant_deals d
    WHERE d.id = _deal_id
      AND public.is_relationship_member(d.relationship_id)
  ) THEN
    RAISE EXCEPTION 'Access denied or deal not found';
  END IF;

  UPDATE public.merchant_deals
  SET status = _status,
      updated_at = now()
  WHERE id = _deal_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_merchant_deal_status(uuid, text) TO authenticated;
