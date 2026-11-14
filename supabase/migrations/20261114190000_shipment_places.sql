-- Shipments, part 3: the name of the area each reading and each location point was taken in
-- ("Port Said, Al-Arab district"), worked out on the driver's phone and stored next to the coordinates.

ALTER TABLE public.shipment_readings
  ADD COLUMN IF NOT EXISTS place_ar text,
  ADD COLUMN IF NOT EXISTS place_en text;
ALTER TABLE public.shipment_locations
  ADD COLUMN IF NOT EXISTS place_ar text,
  ADD COLUMN IF NOT EXISTS place_en text;

-- Trim and cap a place label; empty means none.
CREATE OR REPLACE FUNCTION public.clean_place(p text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT NULLIF(left(btrim(COALESCE(p, '')), 200), '')
$$;

DROP FUNCTION IF EXISTS public.driver_submit_reading(uuid, numeric, numeric, text, text, double precision, double precision, numeric, timestamptz, text, numeric, numeric);
DROP FUNCTION IF EXISTS public.driver_log_location(uuid, double precision, double precision, numeric, timestamptz, text);

CREATE OR REPLACE FUNCTION public.driver_submit_reading(
  p_shipment_id uuid,
  p_temperature numeric,
  p_set_point numeric,
  p_photo_path text,
  p_note text,
  p_lat double precision,
  p_lng double precision,
  p_accuracy numeric,
  p_device_time timestamptz,
  p_entry_mode text,
  p_read_temperature numeric,
  p_read_set_point numeric,
  p_place_ar text DEFAULT NULL,
  p_place_en text DEFAULT NULL
)
RETURNS public.shipment_readings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ship public.shipments%rowtype;
  v_alert boolean;
  v_mismatch boolean;
  v_reading public.shipment_readings%rowtype;
BEGIN
  v_ship := public.driver_shipment_for_update(p_shipment_id);
  IF v_ship.status NOT IN ('preparing', 'on_the_road') THEN RAISE EXCEPTION 'This shipment is no longer active'; END IF;
  IF p_temperature IS NULL OR p_temperature NOT BETWEEN -60 AND 60 THEN RAISE EXCEPTION 'Enter the temperature shown on the screen'; END IF;
  IF p_photo_path IS NULL OR p_photo_path NOT LIKE p_shipment_id::text || '/%' THEN RAISE EXCEPTION 'A photo of the screen is required'; END IF;
  IF p_lat IS NULL OR p_lng IS NULL OR p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION 'Location is required to send a reading';
  END IF;
  IF p_device_time IS NULL THEN RAISE EXCEPTION 'The photo time is required'; END IF;
  IF p_entry_mode IS NULL OR p_entry_mode NOT IN ('auto', 'auto_edited', 'manual') THEN RAISE EXCEPTION 'Unknown entry mode'; END IF;

  v_alert := abs(p_temperature - v_ship.target_temp_c) > v_ship.tolerance_c;
  v_mismatch := abs(extract(epoch FROM (now() - p_device_time))) > 600;

  INSERT INTO public.shipment_readings (
    shipment_id, driver_user_id, temperature_c, set_point_c, photo_path, note, is_alert,
    latitude, longitude, accuracy_m, device_taken_at, time_mismatch, entry_mode, read_temperature_c, read_set_point_c,
    place_ar, place_en
  ) VALUES (
    p_shipment_id, auth.uid(), p_temperature, p_set_point, p_photo_path, NULLIF(btrim(COALESCE(p_note, '')), ''), v_alert,
    p_lat, p_lng, p_accuracy, p_device_time, v_mismatch, p_entry_mode, p_read_temperature, p_read_set_point,
    public.clean_place(p_place_ar), public.clean_place(p_place_en)
  ) RETURNING * INTO v_reading;

  -- The reading's fix is also a point on the truck's trail.
  INSERT INTO public.shipment_locations (shipment_id, driver_user_id, latitude, longitude, accuracy_m, recorded_at, source, place_ar, place_en)
  VALUES (p_shipment_id, auth.uid(), p_lat, p_lng, p_accuracy, LEAST(p_device_time, now()), 'reading', public.clean_place(p_place_ar), public.clean_place(p_place_en))
  ON CONFLICT (shipment_id, recorded_at) DO NOTHING;

  IF v_alert THEN
    INSERT INTO public.notifications (user_id, category, title, body, entity_type, entity_id, target_path)
    VALUES (v_ship.customer_user_id, 'system', 'Temperature alert / تنبيه درجة الحرارة',
            v_ship.reference || ': ' || p_temperature::text || '°C (target ' || v_ship.target_temp_c::text || '°C)',
            'shipment', v_ship.id::text, '/c/shipments');
  END IF;
  RETURN v_reading;
END;
$$;

CREATE OR REPLACE FUNCTION public.driver_log_location(
  p_shipment_id uuid,
  p_lat double precision,
  p_lng double precision,
  p_accuracy numeric,
  p_device_time timestamptz,
  p_source text DEFAULT 'auto',
  p_place_ar text DEFAULT NULL,
  p_place_en text DEFAULT NULL
)
RETURNS public.shipment_locations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ship public.shipments%rowtype;
  v_at timestamptz := LEAST(COALESCE(p_device_time, now()), now());
  v_row public.shipment_locations%rowtype;
BEGIN
  v_ship := public.driver_shipment_for_update(p_shipment_id);
  IF v_ship.status <> 'on_the_road' THEN RAISE EXCEPTION 'The trip is not on the road'; END IF;
  IF p_lat IS NULL OR p_lng IS NULL OR p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION 'Invalid location';
  END IF;
  IF p_source IS NULL OR p_source NOT IN ('auto', 'reading', 'stop') THEN RAISE EXCEPTION 'Unknown location source'; END IF;
  -- A point queued through a long dead zone may arrive late, but not days late.
  IF v_at < now() - interval '3 days' THEN RAISE EXCEPTION 'This location is too old'; END IF;

  INSERT INTO public.shipment_locations (shipment_id, driver_user_id, latitude, longitude, accuracy_m, recorded_at, source, place_ar, place_en)
  VALUES (p_shipment_id, auth.uid(), p_lat, p_lng, p_accuracy, v_at, p_source, public.clean_place(p_place_ar), public.clean_place(p_place_en))
  ON CONFLICT (shipment_id, recorded_at) DO NOTHING;

  SELECT * INTO v_row FROM public.shipment_locations WHERE shipment_id = p_shipment_id AND recorded_at = v_at;
  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.driver_submit_reading(uuid, numeric, numeric, text, text, double precision, double precision, numeric, timestamptz, text, numeric, numeric, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.driver_log_location(uuid, double precision, double precision, numeric, timestamptz, text, text, text) TO authenticated;
