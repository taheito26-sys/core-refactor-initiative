
-- Replace chat_send_message with attachment support
CREATE OR REPLACE FUNCTION public.chat_send_message(
  _room_id uuid,
  _content text,
  _type text DEFAULT 'text'::text,
  _metadata jsonb DEFAULT '{}'::jsonb,
  _reply_to_id uuid DEFAULT NULL::uuid,
  _client_nonce text DEFAULT NULL::text,
  _expires_at timestamptz DEFAULT NULL::timestamptz,
  _view_once boolean DEFAULT false,
  _watermark_text text DEFAULT NULL::text,
  _attachment_id uuid DEFAULT NULL::uuid
)
RETURNS SETOF chat_messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _me  uuid := auth.uid();
  _msg public.chat_messages;
  _att record;
BEGIN
  -- Auth check
  IF _me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  -- Room membership
  IF NOT public.fn_is_chat_member(_room_id, _me) THEN RAISE EXCEPTION 'Not a member'; END IF;

  -- Client nonce idempotency: if a message with this nonce already exists, return it
  IF _client_nonce IS NOT NULL THEN
    SELECT * INTO _msg FROM public.chat_messages
     WHERE room_id = _room_id AND client_nonce = _client_nonce
     LIMIT 1;
    IF FOUND THEN
      RETURN NEXT _msg;
      RETURN;
    END IF;
  END IF;

  -- Validate attachment if provided
  IF _attachment_id IS NOT NULL THEN
    SELECT * INTO _att FROM public.chat_attachments WHERE id = _attachment_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Attachment not found';
    END IF;
    IF _att.uploader_id <> _me THEN
      RAISE EXCEPTION 'Attachment uploader mismatch';
    END IF;
    IF _att.room_id <> _room_id THEN
      RAISE EXCEPTION 'Attachment room mismatch';
    END IF;
    IF _att.message_id IS NOT NULL THEN
      RAISE EXCEPTION 'Attachment already linked to a message';
    END IF;
  END IF;

  -- Insert message
  INSERT INTO public.chat_messages (
    room_id, sender_id, type, content, metadata,
    reply_to_id, client_nonce, expires_at, view_once, watermark_text
  ) VALUES (
    _room_id, _me, _type::public.chat_message_type, _content, _metadata,
    _reply_to_id, _client_nonce, _expires_at, _view_once, _watermark_text
  ) RETURNING * INTO _msg;

  -- Link attachment to the new message (same transaction)
  IF _attachment_id IS NOT NULL THEN
    UPDATE public.chat_attachments
       SET message_id = _msg.id
     WHERE id = _attachment_id;
  END IF;

  -- Update room preview
  UPDATE public.chat_rooms
     SET last_message_id = _msg.id,
         last_message_at = _msg.created_at,
         last_message_preview = left(_content, 120),
         updated_at = now()
   WHERE id = _room_id;

  -- Self-receipt
  INSERT INTO public.chat_message_receipts (message_id, room_id, user_id, status)
  VALUES (_msg.id, _room_id, _me, 'read')
  ON CONFLICT (message_id, user_id) DO NOTHING;

  RETURN NEXT _msg;
END;
$$;

-- Keep callable by authenticated only
REVOKE ALL ON FUNCTION public.chat_send_message(uuid, text, text, jsonb, uuid, text, timestamptz, boolean, text, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.chat_send_message(uuid, text, text, jsonb, uuid, text, timestamptz, boolean, text, uuid) TO authenticated;
