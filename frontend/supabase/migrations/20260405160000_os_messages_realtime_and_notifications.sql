-- ============================================================
-- CRITICAL: Add os_messages to supabase_realtime publication
-- Without this, no INSERT/UPDATE events fire for chat messages,
-- meaning messages never appear in the chat window in real time.
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'os_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.os_messages;
  END IF;
END;
$$;

-- ============================================================
-- REPLICA IDENTITY: needed so UPDATE payloads include old row
-- values (e.g. for read_at propagation)
-- ============================================================
ALTER TABLE public.os_messages REPLICA IDENTITY FULL;

-- ============================================================
-- NOTIFICATION TRIGGER: fire a notification to the counterparty
-- when a new os_messages row is inserted via fn_chat_send_message
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_os_messages_notify_counterparty()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _counterparty_merchant_id TEXT;
  _recipient_user_id        UUID;
  _sender_name              TEXT;
BEGIN
  -- Find the other room member
  SELECT rm.merchant_id INTO _counterparty_merchant_id
  FROM public.os_room_members rm
  WHERE rm.room_id = NEW.room_id
    AND rm.merchant_id <> NEW.sender_merchant_id
  LIMIT 1;

  IF _counterparty_merchant_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Resolve to auth user id
  SELECT user_id INTO _recipient_user_id
  FROM public.merchant_profiles
  WHERE merchant_id = _counterparty_merchant_id
  LIMIT 1;

  IF _recipient_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Sender display name
  SELECT COALESCE(nickname, display_name, sender_merchant_id)
    INTO _sender_name
  FROM public.merchant_profiles
  WHERE merchant_id = NEW.sender_merchant_id
  LIMIT 1;

  -- Skip system messages
  IF NEW.content LIKE '||SYS_%' THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.notifications (user_id, category, title, body, entity_type, entity_id)
  VALUES (
    _recipient_user_id,
    'message',
    COALESCE(_sender_name, 'New message'),
    LEFT(NEW.content, 100),
    'os_room',
    NEW.room_id::text
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_os_messages_notify ON public.os_messages;
CREATE TRIGGER trg_os_messages_notify
  AFTER INSERT ON public.os_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_os_messages_notify_counterparty();
