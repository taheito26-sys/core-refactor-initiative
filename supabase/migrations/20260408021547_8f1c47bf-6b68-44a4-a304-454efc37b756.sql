
-- 1. Notify merchant when a customer sends a connection request
CREATE OR REPLACE FUNCTION public.notify_merchant_on_customer_connection()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _merchant_user_id uuid;
  _customer_name text;
BEGIN
  -- Get the merchant's user_id
  SELECT user_id INTO _merchant_user_id
  FROM merchant_profiles
  WHERE merchant_id = NEW.merchant_id
  LIMIT 1;

  IF _merchant_user_id IS NULL THEN RETURN NEW; END IF;

  -- Get customer name
  SELECT display_name INTO _customer_name
  FROM customer_profiles
  WHERE user_id = NEW.customer_user_id
  LIMIT 1;

  INSERT INTO notifications (user_id, title, body, category, target_path, actor_id, entity_type, entity_id)
  VALUES (
    _merchant_user_id,
    'New Client Request',
    COALESCE(_customer_name, 'A customer') || ' wants to connect with you',
    'customer',
    '/trading/merchants?tab=clients',
    NEW.customer_user_id,
    'customer_connection',
    NEW.id::text
  );

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_merchant_on_customer_connection
  AFTER INSERT ON public.customer_merchant_connections
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_merchant_on_customer_connection();

-- 2. Notify merchant when a customer places an order
CREATE OR REPLACE FUNCTION public.notify_merchant_on_customer_order()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _merchant_user_id uuid;
  _customer_name text;
BEGIN
  SELECT user_id INTO _merchant_user_id
  FROM merchant_profiles
  WHERE merchant_id = NEW.merchant_id
  LIMIT 1;

  IF _merchant_user_id IS NULL THEN RETURN NEW; END IF;

  SELECT display_name INTO _customer_name
  FROM customer_profiles
  WHERE user_id = NEW.customer_user_id
  LIMIT 1;

  INSERT INTO notifications (user_id, title, body, category, target_path, actor_id, entity_type, entity_id)
  VALUES (
    _merchant_user_id,
    'New Customer Order',
    COALESCE(_customer_name, 'A customer') || ' placed a ' || NEW.order_type || ' order for ' || NEW.amount || ' ' || NEW.currency,
    'customer',
    '/trading/merchants?tab=client-orders',
    NEW.customer_user_id,
    'customer_order',
    NEW.id::text
  );

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_merchant_on_customer_order
  AFTER INSERT ON public.customer_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_merchant_on_customer_order();

-- 3. Notify customer when merchant updates order status
CREATE OR REPLACE FUNCTION public.notify_customer_on_order_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _merchant_name text;
  _title text;
  _body text;
BEGIN
  -- Only fire when status actually changes
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;

  SELECT display_name INTO _merchant_name
  FROM merchant_profiles
  WHERE merchant_id = NEW.merchant_id
  LIMIT 1;

  _title := CASE NEW.status
    WHEN 'confirmed' THEN 'Order Confirmed'
    WHEN 'completed' THEN 'Order Completed'
    WHEN 'cancelled' THEN 'Order Cancelled'
    WHEN 'awaiting_payment' THEN 'Payment Requested'
    WHEN 'payment_sent' THEN 'Payment Noted'
    ELSE 'Order Updated'
  END;

  _body := COALESCE(_merchant_name, 'Merchant') || ' updated your ' || NEW.order_type || ' order to: ' || NEW.status;

  INSERT INTO notifications (user_id, title, body, category, target_path, entity_type, entity_id)
  VALUES (
    NEW.customer_user_id,
    _title,
    _body,
    'customer',
    '/c/orders',
    'customer_order',
    NEW.id::text
  );

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_customer_on_order_update
  AFTER UPDATE ON public.customer_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_customer_on_order_update();

-- 4. Notify counterparty on new customer message
CREATE OR REPLACE FUNCTION public.notify_on_customer_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _target_user_id uuid;
  _sender_name text;
  _conn record;
BEGIN
  -- Get connection details
  SELECT * INTO _conn
  FROM customer_merchant_connections
  WHERE id = NEW.connection_id
  LIMIT 1;

  IF _conn IS NULL THEN RETURN NEW; END IF;

  IF NEW.sender_role = 'customer' THEN
    -- Notify merchant
    SELECT user_id INTO _target_user_id
    FROM merchant_profiles
    WHERE merchant_id = _conn.merchant_id
    LIMIT 1;
    
    SELECT display_name INTO _sender_name
    FROM customer_profiles
    WHERE user_id = NEW.sender_user_id
    LIMIT 1;
  ELSE
    -- Notify customer
    _target_user_id := _conn.customer_user_id;
    
    SELECT display_name INTO _sender_name
    FROM merchant_profiles
    WHERE merchant_id = _conn.merchant_id
    LIMIT 1;
  END IF;

  IF _target_user_id IS NULL THEN RETURN NEW; END IF;

  INSERT INTO notifications (user_id, title, body, category, target_path, actor_id, entity_type, entity_id)
  VALUES (
    _target_user_id,
    'New Message',
    COALESCE(_sender_name, 'Someone') || ': ' || LEFT(NEW.content, 100),
    'chat',
    CASE WHEN NEW.sender_role = 'customer' THEN '/trading/merchants?tab=clients' ELSE '/c/chat' END,
    NEW.sender_user_id,
    'customer_message',
    NEW.id::text
  );

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_on_customer_message
  AFTER INSERT ON public.customer_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_on_customer_message();
