-- Temporary: the app version already in use sends readings without location. Keep its function
-- working until the new app (which sends the phone's time and GPS fix) is live, then drop it.
CREATE OR REPLACE FUNCTION public.driver_submit_reading(
  p_shipment_id uuid,
  p_temperature numeric,
  p_set_point numeric,
  p_photo_path text,
  p_note text
)
RETURNS public.shipment_readings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ship public.shipments%rowtype;
  v_alert boolean;
  v_reading public.shipment_readings%rowtype;
BEGIN
  v_ship := public.driver_shipment_for_update(p_shipment_id);
  IF v_ship.status NOT IN ('preparing', 'on_the_road') THEN RAISE EXCEPTION 'This shipment is no longer active'; END IF;
  IF p_temperature IS NULL OR p_temperature NOT BETWEEN -60 AND 60 THEN RAISE EXCEPTION 'Enter the temperature shown on the screen'; END IF;
  IF p_photo_path IS NULL OR p_photo_path NOT LIKE p_shipment_id::text || '/%' THEN RAISE EXCEPTION 'A photo of the screen is required'; END IF;

  v_alert := abs(p_temperature - v_ship.target_temp_c) > v_ship.tolerance_c;

  INSERT INTO public.shipment_readings (shipment_id, driver_user_id, temperature_c, set_point_c, photo_path, note, is_alert)
  VALUES (p_shipment_id, auth.uid(), p_temperature, p_set_point, p_photo_path, NULLIF(btrim(COALESCE(p_note, '')), ''), v_alert)
  RETURNING * INTO v_reading;

  IF v_alert THEN
    INSERT INTO public.notifications (user_id, category, title, body, entity_type, entity_id, target_path)
    VALUES (v_ship.customer_user_id, 'system', 'Temperature alert / تنبيه درجة الحرارة',
            v_ship.reference || ': ' || p_temperature::text || '°C (target ' || v_ship.target_temp_c::text || '°C)',
            'shipment', v_ship.id::text, '/c/shipments');
  END IF;
  RETURN v_reading;
END;
$$;

GRANT EXECUTE ON FUNCTION public.driver_submit_reading(uuid, numeric, numeric, text, text) TO authenticated;
