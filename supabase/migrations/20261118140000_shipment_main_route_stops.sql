-- The nine main stops of the Egypt to Qatar route get an area (and a confirmation radius) when a shipment is created,
-- so an arrival can be checked against the phone's position. Stops from the older route keep their existing areas.
CREATE OR REPLACE FUNCTION public.shipment_stop_defaults() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  area record;
BEGIN
  IF NEW.kind = 'fixed' AND NEW.latitude IS NULL THEN
    SELECT * INTO area FROM (VALUES
      ('Supplier Farm B', 30.6, 30.9, 20),
      ('Salwa border', 24.7, 50.8, 20),
      ('Doha Warehouse 02', 25.285, 51.531, 30),
      ('Obour (Cairo)', 30.228, 31.482, 20),
      ('Kafr El Sheikh', 31.111, 30.939, 20),
      ('Port Said', 31.265, 32.302, 20),
      ('Safaga port', 26.733, 33.936, 20),
      ('Kafr El-Sheikh', 31.111, 30.939, 20),
      ('Safaga Port', 26.733, 33.936, 20),
      ('Duba Port', 27.350, 35.690, 20),
      ('Tabuk', 28.384, 36.555, 30),
      ('Buraydah', 26.326, 43.975, 30),
      ('Riyadh', 24.713, 46.675, 40),
      ('Al-Hofuf', 25.364, 49.588, 30),
      ('Salwa Border Crossing', 24.720, 50.790, 20),
      ('Doha', 25.285, 51.531, 30)
    ) AS v(name_en, lat, lng, radius_km) WHERE v.name_en = NEW.name_en;
    IF FOUND THEN
      NEW.latitude := area.lat;
      NEW.longitude := area.lng;
      NEW.radius_km := area.radius_km;
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- Trips that have not progressed past their first stop move to the nine main stops, keeping the origin's confirmation.
-- Completed, cancelled and already-progressed trips keep the stops they have so history stays intact.
DO $$
DECLARE
  s record;
  v_origin timestamptz;
BEGIN
  FOR s IN
    SELECT sh.id FROM public.shipments sh
    WHERE sh.status IN ('preparing', 'on_the_road')
      AND NOT EXISTS (SELECT 1 FROM public.shipment_stops st WHERE st.shipment_id = sh.id AND st.seq > 10 AND st.reached_at IS NOT NULL)
  LOOP
    SELECT reached_at INTO v_origin FROM public.shipment_stops WHERE shipment_id = s.id AND seq = 10;
    DELETE FROM public.shipment_stops WHERE shipment_id = s.id;
    INSERT INTO public.shipment_stops (shipment_id, seq, name_en, name_ar, kind, reached_at) VALUES
      (s.id, 10, 'Kafr El-Sheikh', 'كفر الشيخ', 'fixed', v_origin),
      (s.id, 20, 'Safaga Port', 'ميناء سفاجا', 'fixed', NULL),
      (s.id, 30, 'Duba Port', 'ميناء ضباء', 'fixed', NULL),
      (s.id, 40, 'Tabuk', 'تبوك', 'fixed', NULL),
      (s.id, 50, 'Buraydah', 'بريدة', 'fixed', NULL),
      (s.id, 60, 'Riyadh', 'الرياض', 'fixed', NULL),
      (s.id, 70, 'Al-Hofuf', 'الهفوف', 'fixed', NULL),
      (s.id, 80, 'Salwa Border Crossing', 'منفذ سلوى', 'fixed', NULL),
      (s.id, 90, 'Doha', 'الدوحة', 'fixed', NULL);
  END LOOP;
END $$;
