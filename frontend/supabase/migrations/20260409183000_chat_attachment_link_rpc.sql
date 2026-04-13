-- Move attachment-to-message linking behind a room-safe RPC.

CREATE OR REPLACE FUNCTION public.chat_link_attachment_to_message(
  _attachment_id UUID,
  _message_id UUID
)
RETURNS public.chat_attachments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid UUID := auth.uid();
  _attachment public.chat_attachments;
  _message public.chat_messages;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT *
  INTO _attachment
  FROM public.chat_attachments
  WHERE id = _attachment_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Attachment not found';
  END IF;

  SELECT *
  INTO _message
  FROM public.chat_messages
  WHERE id = _message_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Message not found';
  END IF;

  IF _attachment.uploader_id <> _uid THEN
    RAISE EXCEPTION 'You can only link your own attachment';
  END IF;

  IF _message.sender_id <> _uid THEN
    RAISE EXCEPTION 'You can only link attachments to your own message';
  END IF;

  IF _attachment.room_id <> _message.room_id THEN
    RAISE EXCEPTION 'Attachment and message must belong to the same room';
  END IF;

  UPDATE public.chat_attachments
  SET message_id = _message_id
  WHERE id = _attachment_id
  RETURNING *
  INTO _attachment;

  RETURN _attachment;
END;
$$;

REVOKE ALL ON FUNCTION public.chat_link_attachment_to_message(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.chat_link_attachment_to_message(UUID, UUID) TO authenticated;
