-- Shipments, part 2: where the truck is and proof for each temperature photo.
--   - Every reading carries the phone's time and GPS fix, taken when the photo was taken, plus how
--     the temperature was entered (read automatically, edited, or typed).
--   - shipment_locations holds the hourly "where is the driver" points and the fix attached to each
--     reading and each confirmed stop.

ALTER TABLE public.shipment_readings
  ADD COLUMN IF NOT EXISTS latitude          double precision CHECK (latitude BETWEEN -90 AND 90),
  ADD COLUMN IF NOT EXISTS longitude         double precision CHECK (longitude BETWEEN -180 AND 180),
  ADD COLUMN IF NOT EXISTS accuracy_m        numeric CHECK (accuracy_m IS NULL OR accuracy_m >= 0),
  ADD COLUMN IF NOT EXISTS device_taken_at   timestamptz,
  -- the phone's clock and the server's disagree by more than 10 minutes
  ADD COLUMN IF NOT EXISTS time_mismatch     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS entry_mode        text NOT NULL DEFAULT 'manual' CHECK (entry_mode IN ('auto', 'auto_edited', 'manual')),
  -- what the automatic reader saw, kept even when the driver corrected it
  ADD COLUMN IF NOT EXISTS read_temperature_c numeric,
  ADD COLUMN IF NOT EXISTS read_set_point_c   numeric;

CREATE TABLE IF NOT EXISTS public.shipment_locations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id    uuid NOT NULL REFERENCES public.shipments(id) ON DELETE CASCADE,
  driver_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  latitude       double precision NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude      double precision NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  accuracy_m     numeric CHECK (accuracy_m IS NULL OR accuracy_m >= 0),
  -- when the phone took the fix (a point queued in a dead zone arrives later)
  recorded_at    timestamptz NOT NULL,
  received_at    timestamptz NOT NULL DEFAULT now(),
  source         text NOT NULL DEFAULT 'auto' CHECK (source IN ('auto', 'reading', 'stop')),
  UNIQUE (shipment_id, recorded_at)
);
CREATE INDEX IF NOT EXISTS idx_shipment_locations_latest ON public.shipment_locations(shipment_id, recorded_at DESC);

ALTER TABLE public.shipment_locations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Shipment parties read locations" ON public.shipment_locations;
CREATE POLICY "Shipment parties read locations" ON public.shipment_locations
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.shipments s WHERE s.id = shipment_locations.shipment_id));

-- ── Driver actions ────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.driver_submit_reading(uuid, numeric, numeric, text, text);

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
  p_read_set_point numeric
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
    latitude, longitude, accuracy_m, device_taken_at, time_mismatch, entry_mode, read_temperature_c, read_set_point_c
  ) VALUES (
    p_shipment_id, auth.uid(), p_temperature, p_set_point, p_photo_path, NULLIF(btrim(COALESCE(p_note, '')), ''), v_alert,
    p_lat, p_lng, p_accuracy, p_device_time, v_mismatch, p_entry_mode, p_read_temperature, p_read_set_point
  ) RETURNING * INTO v_reading;

  -- The reading's fix is also a point on the truck's trail.
  INSERT INTO public.shipment_locations (shipment_id, driver_user_id, latitude, longitude, accuracy_m, recorded_at, source)
  VALUES (p_shipment_id, auth.uid(), p_lat, p_lng, p_accuracy, LEAST(p_device_time, now()), 'reading')
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
  p_source text DEFAULT 'auto'
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

  INSERT INTO public.shipment_locations (shipment_id, driver_user_id, latitude, longitude, accuracy_m, recorded_at, source)
  VALUES (p_shipment_id, auth.uid(), p_lat, p_lng, p_accuracy, v_at, p_source)
  ON CONFLICT (shipment_id, recorded_at) DO NOTHING;

  SELECT * INTO v_row FROM public.shipment_locations WHERE shipment_id = p_shipment_id AND recorded_at = v_at;
  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.driver_submit_reading(uuid, numeric, numeric, text, text, double precision, double precision, numeric, timestamptz, text, numeric, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.driver_log_location(uuid, double precision, double precision, numeric, timestamptz, text) TO authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.shipment_locations; EXCEPTION WHEN duplicate_object THEN NULL; END;
  END IF;
END $$;
