-- Real Egypt → Qatar route: Supplier Farm B → Salwa border → Doha Warehouse 02.
-- New fixed stops get their areas from the trigger; existing shipments are rebuilt below so the
-- customer and driver portals show the real route instead of the old placeholder stops.

CREATE OR REPLACE FUNCTION public.shipment_stop_defaults() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.kind = 'fixed' AND NEW.latitude IS NULL THEN
    NEW.latitude := CASE NEW.name_en
      WHEN 'Supplier Farm B' THEN 30.6
      WHEN 'Salwa border' THEN 24.7
      WHEN 'Doha Warehouse 02' THEN 25.285
    END;
    NEW.longitude := CASE NEW.name_en
      WHEN 'Supplier Farm B' THEN 30.9
      WHEN 'Salwa border' THEN 50.8
      WHEN 'Doha Warehouse 02' THEN 51.531
    END;
  END IF;
  RETURN NEW;
END $$;

DO $$
DECLARE
  s record;
  v_origin timestamptz;
BEGIN
  -- Only rebuild trips that have not started their route in earnest. Completed, cancelled, or
  -- already-progressed trips keep their original stops so historical reporting stays intact.
  FOR s IN
    SELECT s.id
    FROM public.shipments s
    WHERE s.status IN ('preparing', 'on_the_road')
      AND NOT EXISTS (
        SELECT 1
        FROM public.shipment_stops st
        WHERE st.shipment_id = s.id AND st.seq > 10 AND st.reached_at IS NOT NULL
      )
  LOOP
    -- Keep the origin's confirmation; every later stop is part of the new route and starts unconfirmed.
    SELECT reached_at INTO v_origin
    FROM public.shipment_stops
    WHERE shipment_id = s.id AND seq = 10;

    DELETE FROM public.shipment_stops WHERE shipment_id = s.id;

    INSERT INTO public.shipment_stops
      (shipment_id, seq, name_en, name_ar, kind, latitude, longitude, reached_at)
    VALUES
      (s.id, 10, 'Supplier Farm B', 'مزرعة المورد ب', 'fixed', 30.6, 30.9, v_origin),
      (s.id, 20, 'Salwa border', 'منفذ سلوى', 'fixed', 24.7, 50.8, NULL),
      (s.id, 30, 'Doha Warehouse 02', 'مخزن الدوحة 02', 'fixed', 25.285, 51.531, NULL);
  END LOOP;
END $$;
