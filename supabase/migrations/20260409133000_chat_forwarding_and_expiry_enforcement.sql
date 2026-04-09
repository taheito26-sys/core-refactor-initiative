ALTER TABLE public.chat_room_policies
  ADD COLUMN IF NOT EXISTS disable_forwarding BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS disable_export BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS strip_forward_sender_identity BOOLEAN NOT NULL DEFAULT FALSE;

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

  IF _source_message.type IN ('image', 'file', 'voice_note')
     AND EXISTS (
       SELECT 1
       FROM public.chat_attachments a
       WHERE a.message_id = _source_message.id
     ) THEN
    RAISE EXCEPTION 'Attachment forwarding requires attachment duplication support';
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
    SELECT COALESCE(mp.display_name, p.full_name, split_part(u.email, '@', 1), left(_source_message.sender_id::text, 8))
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

  UPDATE public.chat_rooms
  SET last_message_id = _new_message.id,
      last_message_at = _new_message.created_at,
      last_message_preview = left(_new_message.content, 140),
      updated_at = now()
  WHERE id = _target_room_id;

  RETURN _new_message;
END;
$$;

GRANT EXECUTE ON FUNCTION public.chat_forward_message(UUID, UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.chat_export_room_transcript(_room_id UUID)
RETURNS TABLE (
  message_id UUID,
  room_id UUID,
  sender_id UUID,
  sender_name TEXT,
  type public.chat_message_type,
  content TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    m.id AS message_id,
    m.room_id,
    m.sender_id,
    COALESCE(mp.display_name, p.full_name, split_part(u.email, '@', 1), left(m.sender_id::text, 8)) AS sender_name,
    m.type,
    m.content,
    m.metadata,
    m.created_at
  FROM public.chat_messages m
  JOIN public.chat_rooms r
    ON r.id = m.room_id
  LEFT JOIN public.chat_room_policies pol
    ON pol.id = r.policy_id
  LEFT JOIN auth.users u
    ON u.id = m.sender_id
  LEFT JOIN public.merchant_profiles mp
    ON mp.user_id = m.sender_id
  LEFT JOIN public.profiles p
    ON p.user_id = m.sender_id
  WHERE m.room_id = _room_id
    AND public.fn_is_chat_member(_room_id, auth.uid())
    AND COALESCE(pol.disable_export, FALSE) = FALSE
    AND m.is_deleted = FALSE
  ORDER BY m.created_at ASC;
$$;

GRANT EXECUTE ON FUNCTION public.chat_export_room_transcript(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.chat_run_expiry_cleanup()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _expired_messages INTEGER := 0;
  _expired_offers INTEGER := 0;
BEGIN
  UPDATE public.chat_messages
  SET is_deleted = TRUE,
      deleted_at = COALESCE(deleted_at, now()),
      content = '',
      metadata = jsonb_build_object('expired', TRUE, 'expired_at', now()),
      updated_at = now()
  WHERE expires_at IS NOT NULL
    AND expires_at <= now()
    AND is_deleted = FALSE;

  GET DIAGNOSTICS _expired_messages = ROW_COUNT;

  UPDATE public.market_offers
  SET status = 'expired',
      updated_at = now()
  WHERE status = 'active'
    AND expires_at IS NOT NULL
    AND expires_at <= now();

  GET DIAGNOSTICS _expired_offers = ROW_COUNT;

  RETURN jsonb_build_object(
    'expired_messages', _expired_messages,
    'expired_offers', _expired_offers,
    'ran_at', now()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.chat_run_expiry_cleanup() TO authenticated;

CREATE OR REPLACE FUNCTION public.fn_chat_expire_messages()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.chat_run_expiry_cleanup();
  RETURN NULL;
END;
$$;
