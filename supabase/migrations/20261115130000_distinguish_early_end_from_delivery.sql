ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS ended_at timestamptz;
ALTER TABLE public.shipments DROP CONSTRAINT IF EXISTS shipments_status_check;
ALTER TABLE public.shipments ADD CONSTRAINT shipments_status_check CHECK (status IN ('preparing', 'on_the_road', 'delivered', 'ended_early', 'cancelled'));

-- Earlier stop controls used 'delivered'. Preserve genuine deliveries and recover incomplete routes.
UPDATE public.shipments s SET status = 'ended_early', ended_at = delivered_at, delivered_at = NULL
WHERE status = 'delivered' AND EXISTS (
  SELECT 1 FROM public.shipment_stops st WHERE st.shipment_id = s.id AND st.reached_at IS NULL
);

CREATE OR REPLACE FUNCTION public.driver_stop_shipment(p_shipment_id uuid)
RETURNS public.shipments
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_ship public.shipments%rowtype;
BEGIN
  v_ship := public.driver_shipment_for_update(p_shipment_id);
  IF v_ship.status <> 'on_the_road' THEN RAISE EXCEPTION 'Only a trip on the road can be ended'; END IF;
  UPDATE public.shipments SET status = 'ended_early', ended_at = now(), delivered_at = NULL, updated_at = now()
    WHERE id = p_shipment_id RETURNING * INTO v_ship;
  INSERT INTO public.notifications (user_id, category, title, body, entity_type, entity_id, target_path)
    VALUES (v_ship.customer_user_id, 'system', 'Trip ended early / انتهت الرحلة مبكرًا', v_ship.reference,
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
  IF NOT FOUND OR v_ship.customer_user_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Shipment not found or not yours'; END IF;
  IF v_ship.status <> 'ended_early' THEN RAISE EXCEPTION 'Only an early-ended trip can be approved to restart'; END IF;
  UPDATE public.shipments SET status = 'preparing', ended_at = NULL, delivered_at = NULL, updated_at = now()
    WHERE id = p_shipment_id RETURNING * INTO v_ship;
  RETURN v_ship;
END;
$$;
REVOKE ALL ON FUNCTION public.driver_stop_shipment(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.customer_approve_shipment_restart(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.driver_stop_shipment(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.customer_approve_shipment_restart(uuid) TO authenticated;

-- Remove the single simulated GPS point produced during browser verification.
DELETE FROM public.shipment_locations
WHERE id = 'bd7b9745-6197-4e4b-9fdd-b8218c13e4e8'
  AND latitude = 30.04 AND longitude = 31.23 AND accuracy_m = 0 AND source = 'auto';

NOTIFY pgrst, 'reload schema';
