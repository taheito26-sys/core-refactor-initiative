-- Enhance customer order notification system to notify both merchants and customers

-- Helper function to localize currency names
CREATE OR REPLACE FUNCTION public.localize_currency(currency_code TEXT)
RETURNS TEXT LANGUAGE plpgsql IMMUTABLE
AS $$
BEGIN
  CASE WHEN currency_code = 'QAR' THEN RETURN 'قطري';
    WHEN currency_code = 'EGP' THEN RETURN 'مصري';
    WHEN currency_code = 'USD' THEN RETURN 'دولار';
    WHEN currency_code = 'USDT' THEN RETURN 'USDT';
    ELSE RETURN currency_code;
  END CASE;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_notify_customer_order_workflow()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _merchant_user_id UUID;
  _customer_name TEXT;
  _merchant_name TEXT;
  _notification_title TEXT;
  _notification_body TEXT;
  _send_currency_ar TEXT;
  _receive_currency_ar TEXT;
BEGIN
  -- Get merchant and customer info
  SELECT user_id INTO _merchant_user_id
  FROM public.merchant_profiles WHERE merchant_id = NEW.merchant_id LIMIT 1;

  SELECT display_name INTO _customer_name
  FROM public.customer_profiles WHERE user_id = NEW.customer_user_id LIMIT 1;

  SELECT display_name INTO _merchant_name
  FROM public.merchant_profiles WHERE merchant_id = NEW.merchant_id LIMIT 1;

  -- ── Notify on order placement ──
  IF NEW.workflow_status IN ('pending_merchant_approval', 'pending_customer_approval')
    AND NEW.placed_by_user_id IS NOT NULL THEN

    -- Notify merchant when customer places an order (requires merchant approval)
    IF NEW.placed_by_role = 'customer' AND _merchant_user_id IS NOT NULL THEN
      _send_currency_ar := localize_currency(NEW.send_currency);
      _receive_currency_ar := localize_currency(NEW.receive_currency);
      _notification_title := COALESCE(_customer_name, 'A customer') || ' placed an order';
      _notification_body := NEW.amount || ' ' || _send_currency_ar || ' → ' || _receive_currency_ar;

      INSERT INTO public.notifications (user_id, category, title, body, entity_type, entity_id, target_path, target_entity_type, target_entity_id)
      VALUES (
        _merchant_user_id, 'customer_order',
        _notification_title,
        _notification_body,
        'customer_order', NEW.id::text,
        '/trading/orders', 'customer_order', NEW.id::text
      );
    END IF;

    -- Notify customer when merchant places an order (requires customer approval)
    IF NEW.placed_by_role = 'merchant' THEN
      _send_currency_ar := localize_currency(NEW.send_currency);
      _receive_currency_ar := localize_currency(NEW.receive_currency);
      _notification_title := COALESCE(_merchant_name, 'A merchant') || ' placed an order for you';
      _notification_body := NEW.amount || ' ' || _send_currency_ar || ' → ' || _receive_currency_ar;

      INSERT INTO public.notifications (user_id, category, title, body, entity_type, entity_id, target_path, target_entity_type, target_entity_id)
      VALUES (
        NEW.customer_user_id, 'customer_order',
        _notification_title,
        _notification_body,
        'customer_order', NEW.id::text,
        '/customer/orders', 'customer_order', NEW.id::text
      );
    END IF;
  END IF;

  -- ── Notify on approval ──
  IF OLD.workflow_status IS DISTINCT FROM NEW.workflow_status AND NEW.workflow_status = 'approved' THEN
    -- Notify customer that order was approved (by merchant)
    IF NEW.placed_by_role = 'customer' THEN
      _notification_title := COALESCE(_merchant_name, 'The merchant') || ' approved your order';
      _notification_body := NEW.amount || ' ' || localize_currency(NEW.send_currency);

      INSERT INTO public.notifications (user_id, category, title, body, entity_type, entity_id, target_path, target_entity_type, target_entity_id)
      VALUES (
        NEW.customer_user_id, 'customer_order',
        _notification_title,
        _notification_body,
        'customer_order', NEW.id::text,
        '/customer/orders', 'customer_order', NEW.id::text
      );
    END IF;

    -- Notify merchant that order was approved (by customer)
    IF NEW.placed_by_role = 'merchant' AND _merchant_user_id IS NOT NULL THEN
      _notification_title := COALESCE(_customer_name, 'The customer') || ' approved your order';
      _notification_body := NEW.amount || ' ' || localize_currency(NEW.send_currency);

      INSERT INTO public.notifications (user_id, category, title, body, entity_type, entity_id, target_path, target_entity_type, target_entity_id)
      VALUES (
        _merchant_user_id, 'customer_order',
        _notification_title,
        _notification_body,
        'customer_order', NEW.id::text,
        '/trading/orders', 'customer_order', NEW.id::text
      );
    END IF;
  END IF;

  -- ── Notify on rejection ──
  IF OLD.workflow_status IS DISTINCT FROM NEW.workflow_status AND NEW.workflow_status = 'rejected' THEN
    -- Notify customer that order was rejected
    IF NEW.placed_by_role = 'customer' THEN
      _notification_title := COALESCE(_merchant_name, 'The merchant') || ' rejected your order';
      _notification_body := COALESCE(NEW.rejection_reason, 'No reason provided');

      INSERT INTO public.notifications (user_id, category, title, body, entity_type, entity_id, target_path, target_entity_type, target_entity_id)
      VALUES (
        NEW.customer_user_id, 'customer_order',
        _notification_title,
        _notification_body,
        'customer_order', NEW.id::text,
        '/customer/orders', 'customer_order', NEW.id::text
      );
    END IF;

    -- Notify merchant that order was rejected
    IF NEW.placed_by_role = 'merchant' AND _merchant_user_id IS NOT NULL THEN
      _notification_title := COALESCE(_customer_name, 'The customer') || ' rejected your order';
      _notification_body := COALESCE(NEW.rejection_reason, 'No reason provided');

      INSERT INTO public.notifications (user_id, category, title, body, entity_type, entity_id, target_path, target_entity_type, target_entity_id)
      VALUES (
        _merchant_user_id, 'customer_order',
        _notification_title,
        _notification_body,
        'customer_order', NEW.id::text,
        '/trading/orders', 'customer_order', NEW.id::text
      );
    END IF;
  END IF;

  -- ── Notify on edit (revision) ──
  IF OLD.workflow_status IS DISTINCT FROM NEW.workflow_status
    AND NEW.workflow_status IN ('pending_merchant_approval', 'pending_customer_approval')
    AND NEW.revision_no > 1 THEN

    -- Notify merchant that customer edited and re-submitted
    IF NEW.placed_by_role = 'customer' AND _merchant_user_id IS NOT NULL THEN
      _notification_title := COALESCE(_customer_name, 'The customer') || ' updated the order';
      _notification_body := 'Revision ' || NEW.revision_no || ' - ' || NEW.amount || ' ' || localize_currency(NEW.send_currency);

      INSERT INTO public.notifications (user_id, category, title, body, entity_type, entity_id, target_path, target_entity_type, target_entity_id)
      VALUES (
        _merchant_user_id, 'customer_order',
        _notification_title,
        _notification_body,
        'customer_order', NEW.id::text,
        '/trading/orders', 'customer_order', NEW.id::text
      );
    END IF;

    -- Notify customer that merchant edited and re-submitted
    IF NEW.placed_by_role = 'merchant' THEN
      _notification_title := COALESCE(_merchant_name, 'The merchant') || ' updated the order';
      _notification_body := 'Revision ' || NEW.revision_no || ' - ' || NEW.amount || ' ' || localize_currency(NEW.send_currency);

      INSERT INTO public.notifications (user_id, category, title, body, entity_type, entity_id, target_path, target_entity_type, target_entity_id)
      VALUES (
        NEW.customer_user_id, 'customer_order',
        _notification_title,
        _notification_body,
        'customer_order', NEW.id::text,
        '/customer/orders', 'customer_order', NEW.id::text
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Notify about migration
NOTIFY pgrst, 'reload schema';
