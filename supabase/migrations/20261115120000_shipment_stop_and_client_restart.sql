-- Ending a trip is final until its initiating customer explicitly approves another start.
CREATE OR REPLACE FUNCTION public.driver_stop_shipment(p_shipment_id uuid)
RETURNS public.shipments
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_ship public.shipments%rowtype;
BEGIN
  v_ship := public.driver_shipment_for_update(p_shipment_id);
  IF v_ship.status <> 'on_the_road' THEN
    RAISE EXCEPTION 'Only a trip on the road can be ended';
  END IF;
  UPDATE public.shipments SET status = 'delivered', delivered_at = now(), updated_at = now()
    WHERE id = p_shipment_id RETURNING * INTO v_ship;
  INSERT INTO public.notifications (user_id, category, title, body, entity_type, entity_id, target_path)
    VALUES (v_ship.customer_user_id, 'system', 'Trip ended / انتهت الرحلة', v_ship.reference,
      'shipment', v_ship.id::text, '/c/shipments');
  RETURN v_ship;
END;
$$;

CREATE OR REPLACE FUNCTION public.customer_approve_shipment_restart(p_shipment_id uuid)
RETURNS public.shipments
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_ship public.shipments%rowtype;
BEGIN
  SELECT * INTO v_ship FROM public.shipments WHERE id = p_shipment_id FOR UPDATE;
  IF NOT FOUND OR v_ship.customer_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Shipment not found or not yours';
  END IF;
  IF v_ship.status <> 'delivered' THEN
    RAISE EXCEPTION 'Only an ended trip can be approved to restart';
  END IF;
  UPDATE public.shipments SET status = 'preparing', delivered_at = NULL, updated_at = now()
    WHERE id = p_shipment_id RETURNING * INTO v_ship;
  RETURN v_ship;
END;
$$;

-- Only the assigned active driver can accept the customer-approved start.
CREATE OR REPLACE FUNCTION public.driver_start_shipment(p_shipment_id uuid)
RETURNS public.shipments
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_ship public.shipments%rowtype;
BEGIN
  v_ship := public.driver_shipment_for_update(p_shipment_id);
  IF v_ship.status <> 'preparing' THEN
    RAISE EXCEPTION 'This trip has already started or ended. Client approval is required to restart';
  END IF;
  UPDATE public.shipments SET status = 'on_the_road', started_at = COALESCE(started_at, now()), updated_at = now()
    WHERE id = p_shipment_id RETURNING * INTO v_ship;
  UPDATE public.shipment_stops SET reached_at = COALESCE(reached_at, now())
    WHERE id = (SELECT id FROM public.shipment_stops WHERE shipment_id = p_shipment_id ORDER BY seq LIMIT 1);
  RETURN v_ship;
END;
$$;

REVOKE ALL ON FUNCTION public.driver_stop_shipment(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.customer_approve_shipment_restart(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.driver_start_shipment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.driver_stop_shipment(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.customer_approve_shipment_restart(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.driver_start_shipment(uuid) TO authenticated;
