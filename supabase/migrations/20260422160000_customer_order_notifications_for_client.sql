-- Merchant-created customer orders should notify the customer directly.
-- Customer-created orders continue to use the existing merchant notification path.

CREATE OR REPLACE FUNCTION public.notify_customer_order_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _merchant_name text;
  _actor_user_id uuid := auth.uid();
BEGIN
  IF _actor_user_id IS NULL OR _actor_user_id = NEW.customer_user_id THEN
    RETURN NEW;
  END IF;

  SELECT mp.display_name
    INTO _merchant_name
  FROM public.merchant_profiles mp
  WHERE mp.merchant_id = NEW.merchant_id
  LIMIT 1;

  INSERT INTO public.notifications (
    user_id, category, title, body,
    target_path, target_focus, target_entity_type, target_entity_id,
    actor_id
  ) VALUES (
    NEW.customer_user_id,
    'customer_order',
    COALESCE(_merchant_name, 'Your merchant') || ' placed an order for approval',
    NEW.amount || ' ' || NEW.currency || ' · ' || COALESCE(NEW.corridor_label, 'QAR -> EGP'),
    '/c/orders', 'id', 'customer_order', NEW.id::text,
    _actor_user_id
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_customer_order ON public.customer_orders;
CREATE TRIGGER trg_notify_customer_order
  AFTER INSERT ON public.customer_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_customer_order_created();
