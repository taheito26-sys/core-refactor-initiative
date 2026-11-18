-- A customer can remove a cancelled shipment from their list. Child rows cascade from shipments.
CREATE OR REPLACE FUNCTION public.delete_customer_shipment(p_shipment_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in first';
  END IF;

  DELETE FROM public.shipments
  WHERE id = p_shipment_id
    AND customer_user_id = auth.uid()
    AND status = 'cancelled';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Only a cancelled shipment can be deleted';
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.delete_customer_shipment(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.delete_customer_shipment(uuid) TO authenticated;
