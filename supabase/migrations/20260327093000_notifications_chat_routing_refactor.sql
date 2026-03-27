-- Notification routing and chat anchor metadata for deep-link support.
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS notification_type TEXT,
  ADD COLUMN IF NOT EXISTS entity_type TEXT,
  ADD COLUMN IF NOT EXISTS entity_id TEXT,
  ADD COLUMN IF NOT EXISTS relationship_id TEXT,
  ADD COLUMN IF NOT EXISTS message_id TEXT,
  ADD COLUMN IF NOT EXISTS route_path TEXT,
  ADD COLUMN IF NOT EXISTS route_params JSONB;

CREATE INDEX IF NOT EXISTS idx_notifications_relationship_message
  ON public.notifications (user_id, relationship_id, message_id, read_at);

-- Remove duplicate/legacy triggers to avoid double message notifications.
DROP TRIGGER IF EXISTS trg_notify_on_new_message ON public.merchant_messages;
DROP TRIGGER IF EXISTS trg_notify_merchant_message ON public.merchant_messages;

DROP FUNCTION IF EXISTS public.notify_on_new_message();
DROP FUNCTION IF EXISTS public.notify_merchant_message();

CREATE OR REPLACE FUNCTION public.notify_merchant_message_v2()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _rel RECORD;
  _sender_name TEXT;
  _recipient_merchant_id TEXT;
  _recipient_user_id UUID;
  _sender_merchant_id TEXT;
BEGIN
  SELECT merchant_a_id, merchant_b_id INTO _rel
  FROM public.merchant_relationships
  WHERE id = NEW.relationship_id;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  SELECT merchant_id, display_name INTO _sender_merchant_id, _sender_name
  FROM public.merchant_profiles
  WHERE user_id = NEW.sender_id
  LIMIT 1;

  _sender_name := COALESCE(_sender_name, 'Someone');

  IF _sender_merchant_id = _rel.merchant_a_id THEN
    _recipient_merchant_id := _rel.merchant_b_id;
  ELSE
    _recipient_merchant_id := _rel.merchant_a_id;
  END IF;

  SELECT user_id INTO _recipient_user_id
  FROM public.merchant_profiles
  WHERE merchant_id = _recipient_merchant_id
  LIMIT 1;

  IF _recipient_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.notifications (
    user_id,
    title,
    body,
    category,
    notification_type,
    entity_type,
    entity_id,
    relationship_id,
    message_id,
    route_path,
    route_params
  )
  VALUES (
    _recipient_user_id,
    _sender_name || ' sent you a message',
    LEFT(NEW.content, 140),
    'message',
    'chat_message',
    'merchant_message',
    NEW.id::TEXT,
    NEW.relationship_id::TEXT,
    NEW.id::TEXT,
    '/chat',
    jsonb_build_object('conversation', NEW.relationship_id::TEXT, 'message', NEW.id::TEXT, 'highlight', '1')
  );

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_merchant_message_v2
AFTER INSERT ON public.merchant_messages
FOR EACH ROW
EXECUTE FUNCTION public.notify_merchant_message_v2();
