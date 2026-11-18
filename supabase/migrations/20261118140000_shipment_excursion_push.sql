-- A temperature excursion is an event the driver must see immediately, not a
-- line buried in the trip history. The reading function already notifies the
-- customer; this trigger adds the assigned driver as a second recipient and
-- routes the push straight to the driver's trip page.
--
-- The notification row is the single source of truth: the existing
-- trg_notifications_dispatch_push trigger delivers it through push-send, while
-- the driver cockpit also receives it over Supabase Realtime. The dedupe key
-- makes the trigger safe if the same reading is replayed.

CREATE OR REPLACE FUNCTION public.notify_driver_shipment_excursion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ship record;
  v_driver_user_id uuid;
  v_dedupe_key text;
BEGIN
  IF NEW.is_alert IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  SELECT s.reference,
         s.target_temp_c,
         s.tolerance_c,
         d.user_id AS driver_user_id
    INTO v_ship
    FROM public.shipments s
    LEFT JOIN public.shipment_drivers d ON d.id = s.driver_id
   WHERE s.id = NEW.shipment_id;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  v_driver_user_id := COALESCE(v_ship.driver_user_id, NEW.driver_user_id);
  IF v_driver_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_dedupe_key := 'shipment-driver-excursion:' || NEW.id::text;

  IF EXISTS (
    SELECT 1
      FROM public.notifications
     WHERE dedupe_key = v_dedupe_key
  ) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.notifications (
    user_id,
    category,
    title,
    body,
    entity_type,
    entity_id,
    target_path,
    target_entity_type,
    target_entity_id,
    dedupe_key
  ) VALUES (
    v_driver_user_id,
    'system',
    'Temperature excursion / خروج عن النطاق',
    v_ship.reference || ': ' || NEW.temperature_c::text || '°C (allowed '
      || (v_ship.target_temp_c - v_ship.tolerance_c)::text || '…'
      || (v_ship.target_temp_c + v_ship.tolerance_c)::text
      || '°C). Check the reefer now / تحقق من وحدة التبريد الآن.',
    'shipment',
    NEW.shipment_id::text,
    '/d/shipments/' || NEW.shipment_id::text,
    'shipment',
    NEW.shipment_id::text,
    v_dedupe_key
  );

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_driver_shipment_excursion() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_notify_driver_shipment_excursion ON public.shipment_readings;
CREATE TRIGGER trg_notify_driver_shipment_excursion
  AFTER INSERT ON public.shipment_readings
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_driver_shipment_excursion();

NOTIFY pgrst, 'reload schema';
