-- 1. Fix notify_on_new_invite: add target_focus fields
CREATE OR REPLACE FUNCTION public.notify_on_new_invite()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _sender_name TEXT;
  _sender_user_id UUID;
  _recipient_user_id UUID;
BEGIN
  SELECT display_name, user_id INTO _sender_name, _sender_user_id
  FROM public.merchant_profiles
  WHERE merchant_id = NEW.from_merchant_id
  LIMIT 1;

  _sender_name := COALESCE(_sender_name, 'A merchant');

  SELECT user_id INTO _recipient_user_id
  FROM public.merchant_profiles
  WHERE merchant_id = NEW.to_merchant_id
  LIMIT 1;

  IF _recipient_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.notifications (
    user_id, title, body, category,
    actor_id, target_path, target_tab, target_focus,
    target_entity_type, target_entity_id,
    entity_type, entity_id
  )
  VALUES (
    _recipient_user_id,
    '🔔 ' || _sender_name || ' sent you an invite',
    COALESCE(NEW.message, 'You have a new connection request'),
    'invite',
    _sender_user_id,
    '/merchants', NULL, 'focusInviteId',
    'invite', NEW.id::text,
    'invite', NEW.id::text
  );

  RETURN NEW;
END;
$function$;

-- 2. Fix notify_on_invite_status_change: add precise target fields
CREATE OR REPLACE FUNCTION public.notify_on_invite_status_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _actor_name TEXT;
  _actor_user_id UUID;
  _notify_user_id UUID;
  _actor_merchant_id TEXT;
  _target_merchant_id TEXT;
  _title TEXT;
  _body TEXT;
BEGIN
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'accepted' THEN
    _actor_merchant_id := NEW.to_merchant_id;
    _target_merchant_id := NEW.from_merchant_id;

    SELECT display_name, user_id INTO _actor_name, _actor_user_id
    FROM public.merchant_profiles WHERE merchant_id = _actor_merchant_id LIMIT 1;

    SELECT user_id INTO _notify_user_id
    FROM public.merchant_profiles WHERE merchant_id = _target_merchant_id LIMIT 1;

    _title := '✅ ' || COALESCE(_actor_name, 'A merchant') || ' accepted your invite';
    _body := 'You are now connected. Start collaborating!';

  ELSIF NEW.status = 'rejected' THEN
    _actor_merchant_id := NEW.to_merchant_id;
    _target_merchant_id := NEW.from_merchant_id;

    SELECT display_name, user_id INTO _actor_name, _actor_user_id
    FROM public.merchant_profiles WHERE merchant_id = _actor_merchant_id LIMIT 1;

    SELECT user_id INTO _notify_user_id
    FROM public.merchant_profiles WHERE merchant_id = _target_merchant_id LIMIT 1;

    _title := '❌ ' || COALESCE(_actor_name, 'A merchant') || ' declined your invite';
    _body := 'Your connection request was not accepted.';

  ELSE
    RETURN NEW;
  END IF;

  IF _notify_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.notifications (
    user_id, title, body, category,
    actor_id, target_path, target_focus,
    target_entity_type, target_entity_id,
    entity_type, entity_id
  )
  VALUES (
    _notify_user_id, _title, _body, 'invite',
    _actor_user_id, '/merchants', 'focusInviteId',
    'invite', NEW.id::text,
    'invite', NEW.id::text
  );

  RETURN NEW;
END;
$function$;

-- 3. Fix os_send_notification: set conversation_id for chat deep-linking
CREATE OR REPLACE FUNCTION public.os_send_notification(_room_id uuid, _message_id uuid, _urgency text DEFAULT 'normal'::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _msg RECORD;
  _sender_name TEXT;
  _sender_user_id UUID;
  _count integer := 0;
  _member RECORD;
  _user_id uuid;
BEGIN
  SELECT sender_merchant_id, content INTO _msg
  FROM public.os_messages WHERE id = _message_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  SELECT COALESCE(nickname, display_name, merchant_id) INTO _sender_name
  FROM public.merchant_profiles WHERE merchant_id = _msg.sender_merchant_id LIMIT 1;

  SELECT mp.user_id INTO _sender_user_id
  FROM public.merchant_profiles mp WHERE mp.merchant_id = _msg.sender_merchant_id LIMIT 1;

  FOR _member IN
    SELECT rm.merchant_id FROM public.os_room_members rm
    WHERE rm.room_id = _room_id AND rm.merchant_id != _msg.sender_merchant_id
  LOOP
    SELECT mp.user_id INTO _user_id
    FROM public.merchant_profiles mp WHERE mp.merchant_id = _member.merchant_id LIMIT 1;

    IF _user_id IS NOT NULL THEN
      INSERT INTO public.notifications (
        user_id, category, title, body,
        conversation_id, message_id,
        entity_type, entity_id, anchor_id,
        actor_id, target_path, target_focus,
        target_entity_type, target_entity_id
      )
      VALUES (
        _user_id, 'message', COALESCE(_sender_name, 'Unknown'),
        LEFT(_msg.content, 100),
        _room_id, _message_id,
        'os_room', _room_id::text, _message_id::text,
        _sender_user_id, '/chat', 'roomId',
        'os_room', _room_id::text
      );
      _count := _count + 1;
    END IF;
  END LOOP;

  RETURN _count;
END;
$function$;

-- 4. Fix notify_merchant_on_customer_connection: add precise target fields
CREATE OR REPLACE FUNCTION public.notify_merchant_on_customer_connection()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  INSERT INTO notifications (
    user_id, title, body, category,
    target_path, target_tab, target_focus,
    target_entity_type, target_entity_id,
    actor_id, entity_type, entity_id
  )
  VALUES (
    _merchant_user_id,
    'New Client Request',
    COALESCE(_customer_name, 'A customer') || ' wants to connect with you',
    'customer',
    '/merchants', 'clients', 'focusConnectionId',
    'customer_connection', NEW.id::text,
    NEW.customer_user_id,
    'customer_connection', NEW.id::text
  );

  RETURN NEW;
END;
$function$;

-- 5. Fix fn_notify_customer_message: add precise target fields
CREATE OR REPLACE FUNCTION public.fn_notify_customer_message()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _conn RECORD;
  _recipient_user_id UUID;
  _sender_name TEXT;
BEGIN
  SELECT customer_user_id, merchant_id INTO _conn
  FROM public.customer_merchant_connections WHERE id = NEW.connection_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  IF NEW.sender_role = 'customer' THEN
    SELECT user_id INTO _recipient_user_id
    FROM public.merchant_profiles WHERE merchant_id = _conn.merchant_id LIMIT 1;
    SELECT display_name INTO _sender_name
    FROM public.customer_profiles WHERE user_id = NEW.sender_user_id LIMIT 1;
  ELSE
    _recipient_user_id := _conn.customer_user_id;
    SELECT COALESCE(nickname, display_name) INTO _sender_name
    FROM public.merchant_profiles WHERE merchant_id = _conn.merchant_id LIMIT 1;
  END IF;

  IF _recipient_user_id IS NULL THEN RETURN NEW; END IF;

  INSERT INTO public.notifications (
    user_id, category, title, body,
    target_path, target_tab, target_focus,
    target_entity_type, target_entity_id,
    actor_id, entity_type, entity_id
  )
  VALUES (
    _recipient_user_id, 'message',
    COALESCE(_sender_name, 'New message'),
    LEFT(NEW.content, 100),
    CASE WHEN NEW.sender_role = 'customer' THEN '/merchants' ELSE '/c/chat' END,
    CASE WHEN NEW.sender_role = 'customer' THEN 'clients' ELSE NULL END,
    'focusMessageId',
    'customer_message', NEW.id::text,
    NEW.sender_user_id,
    'customer_message', NEW.id::text
  );
  RETURN NEW;
END;
$function$;

-- 6. Fix notify_customer_on_order_update: add precise target fields  
CREATE OR REPLACE FUNCTION public.notify_customer_on_order_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _merchant_name text;
  _title text;
  _body text;
BEGIN
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

  INSERT INTO notifications (
    user_id, title, body, category,
    target_path, target_focus,
    target_entity_type, target_entity_id,
    actor_id, entity_type, entity_id
  )
  VALUES (
    NEW.customer_user_id, _title, _body, 'order',
    '/c/orders', 'focusOrderId',
    'customer_order', NEW.id::text,
    NULL,
    'customer_order', NEW.id::text
  );

  RETURN NEW;
END;
$function$;