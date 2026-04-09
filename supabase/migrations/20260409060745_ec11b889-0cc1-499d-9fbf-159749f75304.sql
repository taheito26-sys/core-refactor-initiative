
CREATE OR REPLACE FUNCTION public.chat_forward_message(
  _message_id   uuid,
  _target_room_id uuid,
  _client_nonce text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _me uuid := auth.uid();
  _msg record;
  _src_room uuid;
  _fwd_disabled boolean;
  _strip_identity boolean;
  _hop_count int := 0;
  _cursor uuid;
  _new_id uuid;
  _sender_name text;
  _att record;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO _msg FROM public.chat_messages WHERE id = _message_id AND is_deleted = false;
  IF NOT FOUND THEN RAISE EXCEPTION 'Message not found'; END IF;
  _src_room := _msg.room_id;

  IF NOT public.fn_is_chat_member(_src_room, _me) THEN
    RAISE EXCEPTION 'Not a member of source room';
  END IF;
  IF NOT public.fn_is_chat_member(_target_room_id, _me) THEN
    RAISE EXCEPTION 'Not a member of target room';
  END IF;

  SELECT COALESCE(p.disable_forwarding, false), COALESCE(p.strip_forward_sender_identity, false)
  INTO _fwd_disabled, _strip_identity
  FROM public.chat_rooms r LEFT JOIN public.chat_room_policies p ON p.id = r.policy_id
  WHERE r.id = _src_room;

  IF _fwd_disabled THEN RAISE EXCEPTION 'Forwarding is disabled in source room'; END IF;
  IF _msg.view_once THEN RAISE EXCEPTION 'Cannot forward view-once messages'; END IF;

  -- Hop limit
  _cursor := _msg.forwarded_from_id;
  WHILE _cursor IS NOT NULL AND _hop_count < 10 LOOP
    _hop_count := _hop_count + 1;
    SELECT forwarded_from_id INTO _cursor FROM public.chat_messages WHERE id = _cursor;
  END LOOP;
  IF _hop_count >= 3 THEN RAISE EXCEPTION 'Forward hop limit exceeded (max 3)'; END IF;

  IF _strip_identity THEN _sender_name := NULL;
  ELSE SELECT display_name INTO _sender_name FROM public.merchant_profiles WHERE user_id = _msg.sender_id LIMIT 1;
  END IF;

  -- Insert forwarded message
  INSERT INTO public.chat_messages (room_id, sender_id, content, type, forwarded_from_id, client_nonce, metadata)
  VALUES (_target_room_id, _me, _msg.content, _msg.type, _message_id, _client_nonce,
    jsonb_build_object('is_forwarded', true, 'original_sender_name', _sender_name))
  RETURNING id INTO _new_id;

  -- Clone attachment if present
  SELECT * INTO _att FROM public.chat_attachments WHERE message_id = _message_id LIMIT 1;
  IF FOUND THEN
    INSERT INTO public.chat_attachments (
      message_id, room_id, uploader_id, storage_path, cdn_url,
      file_name, file_size, mime_type, thumbnail_path,
      duration_ms, width, height, waveform,
      checksum_sha256, is_validated, is_encrypted, iv, auth_tag
    ) VALUES (
      _new_id, _target_room_id, _me, _att.storage_path, _att.cdn_url,
      _att.file_name, _att.file_size, _att.mime_type, _att.thumbnail_path,
      _att.duration_ms, _att.width, _att.height, _att.waveform,
      _att.checksum_sha256, _att.is_validated, _att.is_encrypted, _att.iv, _att.auth_tag
    );
  END IF;

  UPDATE public.chat_rooms SET last_message_at = now(), last_message_id = _new_id,
    last_message_preview = left(_msg.content, 100), updated_at = now()
  WHERE id = _target_room_id;

  RETURN _new_id;
END;
$$;
