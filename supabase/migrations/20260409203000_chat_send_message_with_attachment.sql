-- Make attachment-backed sends atomic on the backend.

CREATE OR REPLACE FUNCTION public.chat_send_message(
  _room_id            UUID,
  _content            TEXT,
  _type               public.chat_message_type DEFAULT 'text',
  _metadata           JSONB   DEFAULT '{}',
  _reply_to_id        UUID    DEFAULT NULL,
  _client_nonce       TEXT    DEFAULT NULL,
  _expires_at         TIMESTAMPTZ DEFAULT NULL,
  _view_once          BOOLEAN DEFAULT FALSE,
  _watermark_text     TEXT    DEFAULT NULL,
  _attachment_id      UUID    DEFAULT NULL
)
RETURNS SETOF public.chat_messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _me  UUID := auth.uid();
  _msg public.chat_messages;
  _attachment public.chat_attachments;
BEGIN
  IF _me IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT public.fn_is_chat_member(_room_id, _me) THEN
    RAISE EXCEPTION 'Not a member of room %', _room_id;
  END IF;

  IF _client_nonce IS NOT NULL THEN
    SELECT * INTO _msg
    FROM public.chat_messages
    WHERE client_nonce = _client_nonce
    LIMIT 1;

    IF FOUND THEN
      RETURN NEXT _msg;
      RETURN;
    END IF;
  END IF;

  IF _attachment_id IS NOT NULL THEN
    SELECT *
    INTO _attachment
    FROM public.chat_attachments
    WHERE id = _attachment_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Attachment not found';
    END IF;

    IF _attachment.uploader_id <> _me THEN
      RAISE EXCEPTION 'You can only send your own attachment';
    END IF;

    IF _attachment.room_id <> _room_id THEN
      RAISE EXCEPTION 'Attachment room mismatch';
    END IF;

    IF _attachment.message_id IS NOT NULL THEN
      RAISE EXCEPTION 'Attachment is already linked to another message';
    END IF;
  END IF;

  INSERT INTO public.chat_messages
    (room_id, sender_id, type, content, metadata, reply_to_id,
     client_nonce, expires_at, view_once, watermark_text)
  VALUES
    (_room_id, _me, _type, _content, _metadata, _reply_to_id,
     _client_nonce, _expires_at, _view_once, _watermark_text)
  RETURNING * INTO _msg;

  IF _attachment_id IS NOT NULL THEN
    UPDATE public.chat_attachments
    SET message_id = _msg.id
    WHERE id = _attachment_id;
  END IF;

  UPDATE public.chat_rooms
  SET last_message_id = _msg.id,
      last_message_at = _msg.created_at,
      last_message_preview = left(_content, 120),
      updated_at = now()
  WHERE id = _room_id;

  INSERT INTO public.chat_message_receipts (message_id, room_id, user_id, status)
  VALUES (_msg.id, _room_id, _me, 'read')
  ON CONFLICT (message_id, user_id) DO NOTHING;

  RETURN NEXT _msg;
END;
$$;

GRANT EXECUTE ON FUNCTION public.chat_send_message(
  UUID, TEXT, public.chat_message_type, JSONB, UUID, TEXT, TIMESTAMPTZ, BOOLEAN, TEXT, UUID
) TO authenticated;
