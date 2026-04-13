CREATE OR REPLACE FUNCTION public.chat_forward_message(
  _message_id UUID,
  _target_room_id UUID,
  _client_nonce TEXT DEFAULT NULL
)
RETURNS public.chat_messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _me UUID := auth.uid();
  _source_message public.chat_messages;
  _new_message public.chat_messages;
  _source_policy public.chat_room_policies;
  _source_room_name TEXT;
  _sender_name TEXT;
  _hop_count INTEGER := 1;
  _forward_metadata JSONB;
  _forward_expires_at TIMESTAMPTZ;
  _source_attachment public.chat_attachments;
BEGIN
  IF _me IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT m.*, r.name, p.*
  INTO _source_message, _source_room_name, _source_policy
  FROM public.chat_messages m
  JOIN public.chat_rooms r
    ON r.id = m.room_id
  LEFT JOIN public.chat_room_policies p
    ON p.id = r.policy_id
  WHERE m.id = _message_id
    AND m.is_deleted = FALSE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Message not found';
  END IF;

  IF NOT public.fn_is_chat_member(_source_message.room_id, _me) THEN
    RAISE EXCEPTION 'Not allowed to forward from this room';
  END IF;

  IF NOT public.fn_is_chat_member(_target_room_id, _me) THEN
    RAISE EXCEPTION 'Not allowed to forward to this room';
  END IF;

  IF _source_message.view_once = TRUE THEN
    RAISE EXCEPTION 'View-once messages cannot be forwarded';
  END IF;

  IF COALESCE(_source_policy.disable_forwarding, FALSE) THEN
    RAISE EXCEPTION 'Forwarding is disabled for this room';
  END IF;

  IF _client_nonce IS NOT NULL THEN
    SELECT *
    INTO _new_message
    FROM public.chat_messages
    WHERE client_nonce = _client_nonce
    LIMIT 1;

    IF FOUND THEN
      RETURN _new_message;
    END IF;
  END IF;

  _hop_count := COALESCE((_source_message.metadata ->> 'forward_hop_count')::INTEGER, 0) + 1;
  IF _hop_count > 5 THEN
    RAISE EXCEPTION 'Forward limit reached for this message';
  END IF;

  IF COALESCE(_source_policy.strip_forward_sender_identity, FALSE) THEN
    _sender_name := 'Hidden sender';
  ELSE
    SELECT COALESCE(
      NULLIF(mp.display_name, ''),
      NULLIF(mp.nickname, ''),
      NULLIF(p.display_name, ''),
      NULLIF(p.full_name, ''),
      NULLIF(p.username, ''),
      NULLIF(u.raw_user_meta_data ->> 'full_name', ''),
      NULLIF(u.raw_user_meta_data ->> 'name', ''),
      NULLIF(split_part(u.email, '@', 1), ''),
      left(_source_message.sender_id::text, 8)
    )
    INTO _sender_name
    FROM auth.users u
    LEFT JOIN public.merchant_profiles mp
      ON mp.user_id = u.id
    LEFT JOIN public.profiles p
      ON p.user_id = u.id
    WHERE u.id = _source_message.sender_id;
  END IF;

  _forward_metadata := COALESCE(_source_message.metadata, '{}'::jsonb)
    || jsonb_build_object(
      'forwarded_from',
      jsonb_build_object(
        'sender_name', _sender_name,
        'room_name', CASE
          WHEN COALESCE(_source_policy.strip_forward_sender_identity, FALSE) THEN NULL
          ELSE _source_room_name
        END
      ),
      'forward_hop_count', _hop_count
    );

  _forward_expires_at := CASE
    WHEN _source_message.expires_at IS NOT NULL AND _source_message.expires_at > now() THEN _source_message.expires_at
    ELSE NULL
  END;

  INSERT INTO public.chat_messages (
    room_id,
    sender_id,
    type,
    content,
    metadata,
    reply_to_id,
    forwarded_from_id,
    client_nonce,
    expires_at,
    view_once,
    watermark_text
  )
  VALUES (
    _target_room_id,
    _me,
    _source_message.type,
    _source_message.content,
    _forward_metadata,
    NULL,
    _source_message.id,
    _client_nonce,
    _forward_expires_at,
    FALSE,
    _source_message.watermark_text
  )
  RETURNING * INTO _new_message;

  SELECT *
  INTO _source_attachment
  FROM public.chat_attachments a
  WHERE a.message_id = _source_message.id
  LIMIT 1;

  IF FOUND THEN
    INSERT INTO public.chat_attachments (
      message_id,
      room_id,
      uploader_id,
      storage_path,
      cdn_url,
      file_name,
      file_size,
      mime_type,
      thumbnail_path,
      duration_ms,
      width,
      height,
      waveform,
      checksum_sha256,
      is_validated,
      is_encrypted,
      iv,
      auth_tag
    )
    VALUES (
      _new_message.id,
      _target_room_id,
      _me,
      _source_attachment.storage_path,
      _source_attachment.cdn_url,
      _source_attachment.file_name,
      _source_attachment.file_size,
      _source_attachment.mime_type,
      _source_attachment.thumbnail_path,
      _source_attachment.duration_ms,
      _source_attachment.width,
      _source_attachment.height,
      _source_attachment.waveform,
      _source_attachment.checksum_sha256,
      _source_attachment.is_validated,
      _source_attachment.is_encrypted,
      _source_attachment.iv,
      _source_attachment.auth_tag
    );
  END IF;

  UPDATE public.chat_rooms
  SET last_message_id = _new_message.id,
      last_message_at = _new_message.created_at,
      last_message_preview = left(
        CASE
          WHEN _new_message.type = 'voice_note' THEN 'Voice message'
          WHEN _new_message.type = 'image' THEN 'Image'
          WHEN _new_message.type = 'file' THEN 'File'
          ELSE _new_message.content
        END,
        140
      ),
      updated_at = now()
  WHERE id = _target_room_id;

  RETURN _new_message;
END;
$$;
