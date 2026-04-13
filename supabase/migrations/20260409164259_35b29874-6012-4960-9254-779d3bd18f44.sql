
CREATE OR REPLACE FUNCTION public.chat_link_attachment_to_message(
  _attachment_id uuid,
  _message_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _me       uuid := auth.uid();
  _att      record;
  _msg      record;
BEGIN
  IF _me IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Load attachment
  SELECT id, room_id, uploader_id, message_id
    INTO _att
    FROM chat_attachments
   WHERE id = _attachment_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Attachment not found';
  END IF;

  IF _att.uploader_id <> _me THEN
    RAISE EXCEPTION 'Not the uploader of this attachment';
  END IF;

  -- Load message
  SELECT id, room_id, sender_id
    INTO _msg
    FROM chat_messages
   WHERE id = _message_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Message not found';
  END IF;

  IF _msg.sender_id <> _me THEN
    RAISE EXCEPTION 'Not the sender of this message';
  END IF;

  -- Room must match
  IF _att.room_id <> _msg.room_id THEN
    RAISE EXCEPTION 'Attachment and message are in different rooms';
  END IF;

  -- Link
  UPDATE chat_attachments
     SET message_id = _message_id
   WHERE id = _attachment_id;
END;
$$;
