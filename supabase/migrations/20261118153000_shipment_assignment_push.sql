-- A driver needs to know as soon as a shipment is assigned, not only when they
-- open the app. This trigger creates one notification row for the assigned
-- driver; the existing trg_notifications_dispatch_push trigger delivers it via
-- push-send, and the driver's notification bell/realtime channel sees it too.
--
-- The trigger covers both entry points: a shipment created with a driver and a
-- later customer_assign_shipment_driver update. The dedupe key includes the
-- assignment timestamp so a replayed transaction cannot duplicate the push,
-- while a genuine reassignment still produces a fresh notification.

CREATE OR REPLACE FUNCTION public.notify_driver_shipment_assigned()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_driver_user_id uuid;
  v_dedupe_key text;
BEGIN
  IF NEW.driver_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- UPDATE OF driver_id also fires when the column is set to the same value;
  -- only a real assignment change is a notification event.
  IF TG_OP = 'UPDATE' AND NEW.driver_id IS NOT DISTINCT FROM OLD.driver_id THEN
    RETURN NEW;
  END IF;

  IF NEW.status NOT IN ('preparing', 'on_the_road') THEN
    RETURN NEW;
  END IF;

  SELECT d.user_id
    INTO v_driver_user_id
    FROM public.shipment_drivers d
   WHERE d.id = NEW.driver_id;

  IF v_driver_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_dedupe_key := 'shipment-assigned:'
    || NEW.id::text || ':'
    || NEW.driver_id::text || ':'
    || NEW.updated_at::text;

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
    'New shipment assigned / شحنة جديدة مسندة',
    NEW.reference || ': ' || NEW.cargo
      || CASE
           WHEN NEW.weight_tons IS NULL THEN ''
           ELSE ' — ' || NEW.weight_tons::text || ' t'
         END
      || '. Open the trip for the route and readings. / افتح الرحلة للاطلاع على المسار والقراءات.',
    'shipment',
    NEW.id::text,
    '/d/shipments/' || NEW.id::text,
    'shipment',
    NEW.id::text,
    v_dedupe_key
  );

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_driver_shipment_assigned() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_notify_driver_shipment_assigned ON public.shipments;
CREATE TRIGGER trg_notify_driver_shipment_assigned
  AFTER INSERT OR UPDATE OF driver_id ON public.shipments
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_driver_shipment_assigned();

NOTIFY pgrst, 'reload schema';