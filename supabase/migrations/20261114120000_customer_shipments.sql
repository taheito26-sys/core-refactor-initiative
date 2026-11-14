-- Customer shipments: Egypt → Qatar reefer trips. The customer dispatches a shipment and assigns
-- one of their own drivers; the driver has a login (role 'driver'), confirms stops, and sends the
-- reefer screen photo plus the typed temperature every few hours. Nothing on the merchant side.
--
-- Writes go through SECURITY DEFINER functions so a driver can only act on a shipment assigned to
-- them, in order, and cannot back-date a reading. Tables expose SELECT only.

CREATE TABLE IF NOT EXISTS public.shipment_drivers (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  owner_customer_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  username               text NOT NULL,
  display_name           text NOT NULL,
  phone                  text,
  truck_plate            text,
  active                 boolean NOT NULL DEFAULT true,
  created_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_shipment_drivers_owner ON public.shipment_drivers(owner_customer_user_id);

CREATE TABLE IF NOT EXISTS public.shipments (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reference              text NOT NULL,
  cargo                  text NOT NULL,
  weight_tons            numeric CHECK (weight_tons IS NULL OR weight_tons > 0),
  target_temp_c          numeric NOT NULL DEFAULT -15 CHECK (target_temp_c BETWEEN -60 AND 60),
  tolerance_c            numeric NOT NULL DEFAULT 3 CHECK (tolerance_c BETWEEN 0 AND 30),
  reading_interval_hours integer NOT NULL DEFAULT 3 CHECK (reading_interval_hours BETWEEN 1 AND 24),
  driver_id              uuid REFERENCES public.shipment_drivers(id) ON DELETE SET NULL,
  status                 text NOT NULL DEFAULT 'preparing'
                         CHECK (status IN ('preparing', 'on_the_road', 'delivered', 'cancelled')),
  note                   text,
  started_at             timestamptz,
  delivered_at           timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (customer_user_id, reference)
);
CREATE INDEX IF NOT EXISTS idx_shipments_customer ON public.shipments(customer_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shipments_driver ON public.shipments(driver_id);

CREATE TABLE IF NOT EXISTS public.shipment_stops (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id uuid NOT NULL REFERENCES public.shipments(id) ON DELETE CASCADE,
  -- numeric so a stop the driver adds can sit between two existing ones
  seq         numeric NOT NULL,
  name_en     text NOT NULL,
  name_ar     text NOT NULL,
  kind        text NOT NULL DEFAULT 'fixed' CHECK (kind IN ('fixed', 'driver')),
  reached_at  timestamptz,
  added_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shipment_id, seq)
);

CREATE TABLE IF NOT EXISTS public.shipment_readings (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id    uuid NOT NULL REFERENCES public.shipments(id) ON DELETE CASCADE,
  driver_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  temperature_c  numeric NOT NULL CHECK (temperature_c BETWEEN -60 AND 60),
  set_point_c    numeric CHECK (set_point_c IS NULL OR set_point_c BETWEEN -60 AND 60),
  photo_path     text NOT NULL,
  note           text,
  is_alert       boolean NOT NULL DEFAULT false,
  taken_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_shipment_readings_shipment ON public.shipment_readings(shipment_id, taken_at DESC);

ALTER TABLE public.shipment_drivers  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shipments         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shipment_stops    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shipment_readings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owner or the driver reads driver" ON public.shipment_drivers;
CREATE POLICY "Owner or the driver reads driver" ON public.shipment_drivers
  FOR SELECT TO authenticated
  USING (owner_customer_user_id = auth.uid() OR user_id = auth.uid());

DROP POLICY IF EXISTS "Owner or assigned driver reads shipment" ON public.shipments;
CREATE POLICY "Owner or assigned driver reads shipment" ON public.shipments
  FOR SELECT TO authenticated
  USING (
    customer_user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.shipment_drivers d WHERE d.id = shipments.driver_id AND d.user_id = auth.uid())
  );

-- The shipments policy applies inside these sub-selects, so stops and readings are visible
-- to exactly the people who can see the shipment.
DROP POLICY IF EXISTS "Shipment parties read stops" ON public.shipment_stops;
CREATE POLICY "Shipment parties read stops" ON public.shipment_stops
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.shipments s WHERE s.id = shipment_stops.shipment_id));

DROP POLICY IF EXISTS "Shipment parties read readings" ON public.shipment_readings;
CREATE POLICY "Shipment parties read readings" ON public.shipment_readings
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.shipments s WHERE s.id = shipment_readings.shipment_id));

-- ── Customer actions ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.create_customer_shipment(
  p_cargo text,
  p_weight_tons numeric,
  p_target_temp numeric,
  p_tolerance numeric,
  p_interval_hours integer,
  p_driver_id uuid,
  p_note text,
  p_stops jsonb
)
RETURNS public.shipments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ref text;
  v_ship public.shipments%rowtype;
  v_stop jsonb;
  v_i integer := 0;
BEGIN
  IF v_uid IS NULL OR NOT EXISTS (SELECT 1 FROM public.customer_profiles WHERE user_id = v_uid) THEN
    RAISE EXCEPTION 'Only customers can dispatch shipments';
  END IF;
  IF p_cargo IS NULL OR length(btrim(p_cargo)) = 0 OR length(p_cargo) > 200 THEN
    RAISE EXCEPTION 'Describe the cargo (up to 200 characters)';
  END IF;
  IF p_driver_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.shipment_drivers d
    WHERE d.id = p_driver_id AND d.owner_customer_user_id = v_uid AND d.active
  ) THEN
    RAISE EXCEPTION 'Choose one of your own active drivers';
  END IF;
  IF jsonb_typeof(p_stops) <> 'array' OR jsonb_array_length(p_stops) NOT BETWEEN 2 AND 12 THEN
    RAISE EXCEPTION 'A shipment needs between 2 and 12 route stops';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('shipment-ref:' || v_uid::text));
  v_ref := 'SH-' || lpad((SELECT count(*) + 1 FROM public.shipments WHERE customer_user_id = v_uid)::text, 4, '0');

  INSERT INTO public.shipments (customer_user_id, reference, cargo, weight_tons, target_temp_c,
                                tolerance_c, reading_interval_hours, driver_id, note)
  VALUES (v_uid, v_ref, btrim(p_cargo), p_weight_tons, COALESCE(p_target_temp, -15),
          COALESCE(p_tolerance, 3), COALESCE(p_interval_hours, 3), p_driver_id, NULLIF(btrim(COALESCE(p_note, '')), ''))
  RETURNING * INTO v_ship;

  FOR v_stop IN SELECT * FROM jsonb_array_elements(p_stops) LOOP
    v_i := v_i + 1;
    INSERT INTO public.shipment_stops (shipment_id, seq, name_en, name_ar, kind)
    VALUES (v_ship.id, v_i * 10, left(v_stop ->> 'name_en', 80), left(v_stop ->> 'name_ar', 80), 'fixed');
  END LOOP;

  RETURN v_ship;
END;
$$;

CREATE OR REPLACE FUNCTION public.customer_assign_shipment_driver(p_shipment_id uuid, p_driver_id uuid)
RETURNS public.shipments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_ship public.shipments%rowtype;
BEGIN
  SELECT * INTO v_ship FROM public.shipments WHERE id = p_shipment_id AND customer_user_id = auth.uid() FOR UPDATE;
  IF v_ship.id IS NULL THEN RAISE EXCEPTION 'Shipment not found'; END IF;
  IF v_ship.status <> 'preparing' THEN RAISE EXCEPTION 'The driver can only be changed before the trip starts'; END IF;
  IF p_driver_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.shipment_drivers d
    WHERE d.id = p_driver_id AND d.owner_customer_user_id = auth.uid() AND d.active
  ) THEN
    RAISE EXCEPTION 'Choose one of your own active drivers';
  END IF;
  UPDATE public.shipments SET driver_id = p_driver_id, updated_at = now() WHERE id = p_shipment_id RETURNING * INTO v_ship;
  RETURN v_ship;
END;
$$;

CREATE OR REPLACE FUNCTION public.customer_cancel_shipment(p_shipment_id uuid)
RETURNS public.shipments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_ship public.shipments%rowtype;
BEGIN
  SELECT * INTO v_ship FROM public.shipments WHERE id = p_shipment_id AND customer_user_id = auth.uid() FOR UPDATE;
  IF v_ship.id IS NULL THEN RAISE EXCEPTION 'Shipment not found'; END IF;
  IF v_ship.status NOT IN ('preparing', 'on_the_road') THEN RAISE EXCEPTION 'This shipment can no longer be cancelled'; END IF;
  UPDATE public.shipments SET status = 'cancelled', updated_at = now() WHERE id = p_shipment_id RETURNING * INTO v_ship;
  RETURN v_ship;
END;
$$;

CREATE OR REPLACE FUNCTION public.customer_set_driver_active(p_driver_id uuid, p_active boolean)
RETURNS public.shipment_drivers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_driver public.shipment_drivers%rowtype;
BEGIN
  UPDATE public.shipment_drivers SET active = p_active
  WHERE id = p_driver_id AND owner_customer_user_id = auth.uid()
  RETURNING * INTO v_driver;
  IF v_driver.id IS NULL THEN RAISE EXCEPTION 'Driver not found'; END IF;
  RETURN v_driver;
END;
$$;

-- ── Driver actions ────────────────────────────────────────────────

-- Locks and returns a shipment only if it is assigned to the calling, active driver.
CREATE OR REPLACE FUNCTION public.driver_shipment_for_update(p_shipment_id uuid)
RETURNS public.shipments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_ship public.shipments%rowtype;
BEGIN
  SELECT s.* INTO v_ship
  FROM public.shipments s
  JOIN public.shipment_drivers d ON d.id = s.driver_id
  WHERE s.id = p_shipment_id AND d.user_id = auth.uid() AND d.active
  FOR UPDATE OF s;
  IF v_ship.id IS NULL THEN RAISE EXCEPTION 'Shipment not found'; END IF;
  RETURN v_ship;
END;
$$;

CREATE OR REPLACE FUNCTION public.driver_start_shipment(p_shipment_id uuid)
RETURNS public.shipments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_ship public.shipments%rowtype;
BEGIN
  v_ship := public.driver_shipment_for_update(p_shipment_id);
  IF v_ship.status <> 'preparing' THEN RAISE EXCEPTION 'This trip has already started or ended'; END IF;
  UPDATE public.shipments SET status = 'on_the_road', started_at = now(), updated_at = now()
  WHERE id = p_shipment_id RETURNING * INTO v_ship;
  -- The driver is at the first stop when the trip starts.
  UPDATE public.shipment_stops SET reached_at = now()
  WHERE id = (SELECT id FROM public.shipment_stops WHERE shipment_id = p_shipment_id ORDER BY seq LIMIT 1);
  RETURN v_ship;
END;
$$;

CREATE OR REPLACE FUNCTION public.driver_reach_stop(p_stop_id uuid)
RETURNS public.shipments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ship public.shipments%rowtype;
  v_shipment_id uuid;
  v_next_id uuid;
  v_pending integer;
BEGIN
  SELECT shipment_id INTO v_shipment_id FROM public.shipment_stops WHERE id = p_stop_id;
  IF v_shipment_id IS NULL THEN RAISE EXCEPTION 'Stop not found'; END IF;
  v_ship := public.driver_shipment_for_update(v_shipment_id);
  IF v_ship.status <> 'on_the_road' THEN RAISE EXCEPTION 'The trip is not on the road'; END IF;

  SELECT id INTO v_next_id FROM public.shipment_stops
  WHERE shipment_id = v_shipment_id AND reached_at IS NULL ORDER BY seq LIMIT 1;
  IF v_next_id IS DISTINCT FROM p_stop_id THEN RAISE EXCEPTION 'Stops are confirmed in order'; END IF;

  UPDATE public.shipment_stops SET reached_at = now() WHERE id = p_stop_id;

  SELECT count(*) INTO v_pending FROM public.shipment_stops WHERE shipment_id = v_shipment_id AND reached_at IS NULL;
  IF v_pending = 0 THEN
    UPDATE public.shipments SET status = 'delivered', delivered_at = now(), updated_at = now()
    WHERE id = v_shipment_id RETURNING * INTO v_ship;
    INSERT INTO public.notifications (user_id, category, title, body, entity_type, entity_id, target_path)
    VALUES (v_ship.customer_user_id, 'system', 'Shipment delivered / تم تسليم الشحنة', v_ship.reference,
            'shipment', v_ship.id::text, '/c/shipments');
  END IF;
  RETURN v_ship;
END;
$$;

CREATE OR REPLACE FUNCTION public.driver_add_stop(p_shipment_id uuid, p_name text)
RETURNS public.shipment_stops
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ship public.shipments%rowtype;
  v_name text := btrim(COALESCE(p_name, ''));
  v_after numeric;
  v_before numeric;
  v_stop public.shipment_stops%rowtype;
BEGIN
  v_ship := public.driver_shipment_for_update(p_shipment_id);
  IF v_ship.status <> 'on_the_road' THEN RAISE EXCEPTION 'Stops can be added while the trip is on the road'; END IF;
  IF length(v_name) < 2 OR length(v_name) > 80 THEN RAISE EXCEPTION 'Stop name must be 2 to 80 characters'; END IF;

  SELECT min(seq) INTO v_before FROM public.shipment_stops WHERE shipment_id = p_shipment_id AND reached_at IS NULL;
  IF v_before IS NULL THEN RAISE EXCEPTION 'There is no stop left to add before'; END IF;
  SELECT COALESCE(max(seq), v_before - 10) INTO v_after FROM public.shipment_stops
  WHERE shipment_id = p_shipment_id AND reached_at IS NOT NULL;

  INSERT INTO public.shipment_stops (shipment_id, seq, name_en, name_ar, kind, added_by)
  VALUES (p_shipment_id, (v_after + v_before) / 2, v_name, v_name, 'driver', auth.uid())
  RETURNING * INTO v_stop;
  RETURN v_stop;
END;
$$;

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

REVOKE ALL ON FUNCTION public.driver_shipment_for_update(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_customer_shipment(text, numeric, numeric, numeric, integer, uuid, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.customer_assign_shipment_driver(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.customer_cancel_shipment(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.customer_set_driver_active(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.driver_start_shipment(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.driver_reach_stop(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.driver_add_stop(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.driver_submit_reading(uuid, numeric, numeric, text, text) TO authenticated;

-- ── Reefer screen photos ──────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('shipment-photos', 'shipment-photos', false, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO NOTHING;

-- Photos live under <shipment id>/<file>. The assigned driver uploads; the owner and the driver read.
DROP POLICY IF EXISTS "Assigned driver uploads shipment photos" ON storage.objects;
CREATE POLICY "Assigned driver uploads shipment photos" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'shipment-photos'
    AND EXISTS (
      SELECT 1 FROM public.shipments s
      JOIN public.shipment_drivers d ON d.id = s.driver_id
      WHERE s.id::text = (storage.foldername(name))[1] AND d.user_id = auth.uid() AND d.active
    )
  );

DROP POLICY IF EXISTS "Shipment parties read shipment photos" ON storage.objects;
CREATE POLICY "Shipment parties read shipment photos" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'shipment-photos'
    AND EXISTS (SELECT 1 FROM public.shipments s WHERE s.id::text = (storage.foldername(name))[1])
  );

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.shipments; EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.shipment_stops; EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.shipment_readings; EXCEPTION WHEN duplicate_object THEN NULL; END;
  END IF;
END $$;
