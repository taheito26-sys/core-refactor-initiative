
-- TASK 1: Add os_messages to realtime publication
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

ALTER TABLE public.os_messages REPLICA IDENTITY FULL;

CREATE OR REPLACE FUNCTION public.fn_os_messages_notify_counterparty()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _counterparty_merchant_id TEXT;
  _recipient_user_id UUID;
  _sender_name TEXT;
BEGIN
  SELECT rm.merchant_id INTO _counterparty_merchant_id
  FROM public.os_room_members rm
  WHERE rm.room_id = NEW.room_id AND rm.merchant_id <> NEW.sender_merchant_id
  LIMIT 1;
  IF _counterparty_merchant_id IS NULL THEN RETURN NEW; END IF;

  SELECT user_id INTO _recipient_user_id
  FROM public.merchant_profiles WHERE merchant_id = _counterparty_merchant_id LIMIT 1;
  IF _recipient_user_id IS NULL THEN RETURN NEW; END IF;

  SELECT COALESCE(nickname, display_name, sender_merchant_id)
    INTO _sender_name
  FROM public.merchant_profiles WHERE merchant_id = NEW.sender_merchant_id LIMIT 1;

  IF NEW.content LIKE '||SYS_%' THEN RETURN NEW; END IF;

  INSERT INTO public.notifications (user_id, category, title, body, entity_type, entity_id)
  VALUES (_recipient_user_id, 'message', COALESCE(_sender_name, 'New message'),
          LEFT(NEW.content, 100), 'os_room', NEW.room_id::text);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_os_messages_notify ON public.os_messages;
CREATE TRIGGER trg_os_messages_notify
  AFTER INSERT ON public.os_messages
  FOR EACH ROW EXECUTE FUNCTION public.fn_os_messages_notify_counterparty();

-- TASK 2: Update fn_chat_send_message to return created_at
CREATE OR REPLACE FUNCTION public.fn_chat_send_message(
    _room_id UUID, _body TEXT, _body_json JSONB DEFAULT '{}'::jsonb,
    _message_type TEXT DEFAULT 'text', _client_nonce TEXT DEFAULT NULL,
    _reply_to_message_id UUID DEFAULT NULL, _expires_at TIMESTAMPTZ DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    _msg_id UUID; _mid TEXT; _now TIMESTAMPTZ;
BEGIN
    _mid := public.current_merchant_id();
    IF _mid IS NULL THEN RAISE EXCEPTION 'No merchant profile found for current user'; END IF;
    _now := now();

    INSERT INTO public.os_messages (room_id, sender_merchant_id, content, expires_at, created_at)
    VALUES (_room_id, _mid, _body, _expires_at, _now)
    RETURNING id INTO _msg_id;

    UPDATE public.os_rooms SET updated_at = _now WHERE id = _room_id;

    RETURN jsonb_build_object(
      'id', _msg_id, 'room_id', _room_id, 'content', _body,
      'sender_merchant_id', _mid, 'created_at', _now
    );
END;
$$;

-- TASK 3: Fix fn_chat_mark_read to mark ALL messages up to the given ID
CREATE OR REPLACE FUNCTION public.fn_chat_mark_read(
    _room_id UUID, _message_id UUID
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _cutoff TIMESTAMPTZ; _mid TEXT;
BEGIN
    _mid := public.current_merchant_id();
    SELECT created_at INTO _cutoff FROM public.os_messages
    WHERE id = _message_id AND room_id = _room_id;
    IF NOT FOUND THEN RETURN FALSE; END IF;

    UPDATE public.os_messages
    SET read_at = now()
    WHERE room_id = _room_id
      AND sender_merchant_id <> _mid
      AND created_at <= _cutoff
      AND read_at IS NULL;

    RETURN FOUND;
END;
$$;
