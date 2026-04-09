
-- 1. Add policy columns (idempotent)
ALTER TABLE public.chat_room_policies
  ADD COLUMN IF NOT EXISTS disable_forwarding boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS disable_export boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS strip_forward_sender_identity boolean NOT NULL DEFAULT false;

-- 2. Drop and recreate chat_get_rooms_v2 with new return type
DROP FUNCTION IF EXISTS public.chat_get_rooms_v2();

CREATE OR REPLACE FUNCTION public.chat_get_rooms_v2()
RETURNS TABLE(
  room_id uuid,
  room_name text,
  room_type text,
  is_direct boolean,
  last_message_at timestamptz,
  last_message_preview text,
  unread_count bigint,
  my_role text,
  is_muted boolean,
  is_pinned boolean,
  is_archived boolean,
  room_policy jsonb
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE _me UUID := auth.uid();
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  RETURN QUERY
    SELECT
      r.id,
      r.name,
      r.type::text,
      r.is_direct,
      r.last_message_at,
      r.last_message_preview,
      COALESCE((
        SELECT count(*) FROM public.chat_messages m
        WHERE m.room_id = r.id AND m.is_deleted = false
          AND m.created_at > COALESCE(mem.last_read_at, mem.joined_at)
          AND m.sender_id <> _me
      ), 0)::bigint,
      mem.role::text,
      mem.is_muted,
      mem.is_pinned,
      mem.is_archived,
      CASE WHEN p.id IS NOT NULL THEN jsonb_build_object(
        'encryption_mode', p.encryption_mode::text,
        'allow_calls', p.allow_calls,
        'allow_files', p.allow_files,
        'allow_images', p.allow_images,
        'allow_voice_notes', p.allow_voice_notes,
        'screenshot_protection', p.screenshot_protection,
        'watermark_enabled', p.watermark_enabled,
        'disable_forwarding', p.disable_forwarding,
        'disable_export', p.disable_export,
        'strip_forward_sender_identity', p.strip_forward_sender_identity,
        'retention_hours', p.retention_hours,
        'max_file_size_mb', p.max_file_size_mb
      ) ELSE NULL END
    FROM public.chat_rooms r
    JOIN public.chat_room_members mem ON mem.room_id = r.id AND mem.user_id = _me AND mem.removed_at IS NULL
    LEFT JOIN public.chat_room_policies p ON p.id = r.policy_id
    ORDER BY COALESCE(r.last_message_at, r.created_at) DESC;
END;
$$;

-- 3. chat_forward_message
DROP FUNCTION IF EXISTS public.chat_forward_message(uuid, uuid, text);

CREATE OR REPLACE FUNCTION public.chat_forward_message(
  _message_id uuid,
  _target_room_id uuid,
  _client_nonce text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = 'public'
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
  IF EXISTS (SELECT 1 FROM public.chat_attachments WHERE message_id = _message_id) THEN
    RAISE EXCEPTION 'Cannot forward messages with attachments (not yet supported)';
  END IF;

  _cursor := _msg.forwarded_from_id;
  WHILE _cursor IS NOT NULL AND _hop_count < 10 LOOP
    _hop_count := _hop_count + 1;
    SELECT forwarded_from_id INTO _cursor FROM public.chat_messages WHERE id = _cursor;
  END LOOP;
  IF _hop_count >= 3 THEN RAISE EXCEPTION 'Forward hop limit exceeded (max 3)'; END IF;

  IF _strip_identity THEN _sender_name := NULL;
  ELSE SELECT display_name INTO _sender_name FROM public.merchant_profiles WHERE user_id = _msg.sender_id LIMIT 1;
  END IF;

  INSERT INTO public.chat_messages (room_id, sender_id, content, type, forwarded_from_id, client_nonce, metadata)
  VALUES (_target_room_id, _me, _msg.content, _msg.type, _message_id, _client_nonce,
    jsonb_build_object('is_forwarded', true, 'original_sender_name', _sender_name))
  RETURNING id INTO _new_id;

  UPDATE public.chat_rooms SET last_message_at = now(), last_message_id = _new_id,
    last_message_preview = left(_msg.content, 100), updated_at = now()
  WHERE id = _target_room_id;

  RETURN _new_id;
END;
$$;

-- 4. chat_export_room_transcript
DROP FUNCTION IF EXISTS public.chat_export_room_transcript(uuid);

CREATE OR REPLACE FUNCTION public.chat_export_room_transcript(_room_id uuid)
RETURNS TABLE(sender_name text, content text, sent_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  _me uuid := auth.uid();
  _export_disabled boolean;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.fn_is_chat_member(_room_id, _me) THEN RAISE EXCEPTION 'Not a member of this room'; END IF;

  SELECT COALESCE(p.disable_export, false) INTO _export_disabled
  FROM public.chat_rooms r LEFT JOIN public.chat_room_policies p ON p.id = r.policy_id
  WHERE r.id = _room_id;

  IF _export_disabled THEN RAISE EXCEPTION 'Export is disabled for this room'; END IF;

  RETURN QUERY
    SELECT COALESCE(mp.display_name, 'Unknown'), m.content, m.created_at
    FROM public.chat_messages m
    LEFT JOIN public.merchant_profiles mp ON mp.user_id = m.sender_id
    WHERE m.room_id = _room_id AND m.is_deleted = false
    ORDER BY m.created_at ASC;
END;
$$;

-- 5. chat_run_expiry_cleanup
DROP FUNCTION IF EXISTS public.chat_run_expiry_cleanup();

CREATE OR REPLACE FUNCTION public.chat_run_expiry_cleanup()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE _msgs int; _offers int;
BEGIN
  WITH expired AS (
    UPDATE public.chat_messages SET is_deleted = true, deleted_at = now()
    WHERE expires_at IS NOT NULL AND expires_at < now() AND is_deleted = false
    RETURNING id
  ) SELECT count(*) INTO _msgs FROM expired;

  WITH expired_offers AS (
    UPDATE public.market_offers SET status = 'expired', updated_at = now()
    WHERE expires_at IS NOT NULL AND expires_at < now() AND status = 'active'
    RETURNING id
  ) SELECT count(*) INTO _offers FROM expired_offers;

  RETURN jsonb_build_object('messages_expired', _msgs, 'offers_expired', _offers);
END;
$$;

-- 6. fn_chat_expire_messages delegates
DROP FUNCTION IF EXISTS public.fn_chat_expire_messages();

CREATE OR REPLACE FUNCTION public.fn_chat_expire_messages()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN RETURN public.chat_run_expiry_cleanup(); END;
$$;
