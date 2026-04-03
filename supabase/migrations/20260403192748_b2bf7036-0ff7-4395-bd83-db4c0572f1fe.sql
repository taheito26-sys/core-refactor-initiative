
CREATE OR REPLACE FUNCTION public.set_merchant_deal_status(_deal_id uuid, _status text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Verify caller is a member of the deal's relationship
  IF NOT EXISTS (
    SELECT 1 FROM public.merchant_deals d
    WHERE d.id = _deal_id
      AND public.is_relationship_member(d.relationship_id)
  ) THEN
    RAISE EXCEPTION 'Access denied: not a member of this deal relationship';
  END IF;

  UPDATE public.merchant_deals
  SET status = _status, updated_at = now()
  WHERE id = _deal_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_merchant_deal_status(uuid, text) TO authenticated;
