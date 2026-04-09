CREATE TABLE IF NOT EXISTS public.chat_user_privacy_settings (
  user_id                       UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  hide_read_receipts            BOOLEAN NOT NULL DEFAULT FALSE,
  hide_last_seen                BOOLEAN NOT NULL DEFAULT FALSE,
  hide_typing                   BOOLEAN NOT NULL DEFAULT FALSE,
  invisible_mode                BOOLEAN NOT NULL DEFAULT FALSE,
  online_visibility             TEXT NOT NULL DEFAULT 'everyone' CHECK (online_visibility IN ('everyone', 'room_members', 'nobody')),
  notification_preview          TEXT NOT NULL DEFAULT 'full' CHECK (notification_preview IN ('full', 'sender_only', 'none')),
  show_sender_in_notification   BOOLEAN NOT NULL DEFAULT TRUE,
  anonymous_mode                BOOLEAN NOT NULL DEFAULT FALSE,
  screenshot_protection         BOOLEAN NOT NULL DEFAULT FALSE,
  watermark_enabled             BOOLEAN NOT NULL DEFAULT FALSE,
  forwarding_disabled           BOOLEAN NOT NULL DEFAULT FALSE,
  copy_disabled                 BOOLEAN NOT NULL DEFAULT FALSE,
  export_disabled               BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.chat_user_privacy_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "privacy_settings_self_select" ON public.chat_user_privacy_settings;
CREATE POLICY "privacy_settings_self_select" ON public.chat_user_privacy_settings
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "privacy_settings_self_upsert" ON public.chat_user_privacy_settings;
CREATE POLICY "privacy_settings_self_upsert" ON public.chat_user_privacy_settings
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.chat_touch_privacy_settings_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_chat_touch_privacy_settings_updated_at ON public.chat_user_privacy_settings;
CREATE TRIGGER trg_chat_touch_privacy_settings_updated_at
BEFORE UPDATE ON public.chat_user_privacy_settings
FOR EACH ROW
EXECUTE FUNCTION public.chat_touch_privacy_settings_updated_at();

CREATE OR REPLACE FUNCTION public.chat_get_privacy_settings()
RETURNS public.chat_user_privacy_settings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _me UUID := auth.uid();
  _row public.chat_user_privacy_settings;
BEGIN
  INSERT INTO public.chat_user_privacy_settings (user_id)
  VALUES (_me)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT *
  INTO _row
  FROM public.chat_user_privacy_settings
  WHERE user_id = _me;

  RETURN _row;
END;
$$;

CREATE OR REPLACE FUNCTION public.chat_update_privacy_settings(
  _hide_read_receipts BOOLEAN DEFAULT NULL,
  _hide_last_seen BOOLEAN DEFAULT NULL,
  _hide_typing BOOLEAN DEFAULT NULL,
  _invisible_mode BOOLEAN DEFAULT NULL,
  _online_visibility TEXT DEFAULT NULL,
  _notification_preview TEXT DEFAULT NULL,
  _show_sender_in_notification BOOLEAN DEFAULT NULL,
  _anonymous_mode BOOLEAN DEFAULT NULL,
  _screenshot_protection BOOLEAN DEFAULT NULL,
  _watermark_enabled BOOLEAN DEFAULT NULL,
  _forwarding_disabled BOOLEAN DEFAULT NULL,
  _copy_disabled BOOLEAN DEFAULT NULL,
  _export_disabled BOOLEAN DEFAULT NULL
)
RETURNS public.chat_user_privacy_settings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _me UUID := auth.uid();
  _row public.chat_user_privacy_settings;
BEGIN
  INSERT INTO public.chat_user_privacy_settings (user_id)
  VALUES (_me)
  ON CONFLICT (user_id) DO NOTHING;

  UPDATE public.chat_user_privacy_settings
  SET hide_read_receipts = COALESCE(_hide_read_receipts, hide_read_receipts),
      hide_last_seen = COALESCE(_hide_last_seen, hide_last_seen),
      hide_typing = COALESCE(_hide_typing, hide_typing),
      invisible_mode = COALESCE(_invisible_mode, invisible_mode),
      online_visibility = COALESCE(_online_visibility, online_visibility),
      notification_preview = COALESCE(_notification_preview, notification_preview),
      show_sender_in_notification = COALESCE(_show_sender_in_notification, show_sender_in_notification),
      anonymous_mode = COALESCE(_anonymous_mode, anonymous_mode),
      screenshot_protection = COALESCE(_screenshot_protection, screenshot_protection),
      watermark_enabled = COALESCE(_watermark_enabled, watermark_enabled),
      forwarding_disabled = COALESCE(_forwarding_disabled, forwarding_disabled),
      copy_disabled = COALESCE(_copy_disabled, copy_disabled),
      export_disabled = COALESCE(_export_disabled, export_disabled)
  WHERE user_id = _me
  RETURNING * INTO _row;

  RETURN _row;
END;
$$;

CREATE OR REPLACE FUNCTION public.chat_users_share_room(_user_a UUID, _user_b UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.chat_room_members a
    JOIN public.chat_room_members b
      ON b.room_id = a.room_id
    WHERE a.user_id = _user_a
      AND b.user_id = _user_b
      AND a.removed_at IS NULL
      AND b.removed_at IS NULL
  );
$$;

CREATE OR REPLACE FUNCTION public.chat_can_view_presence(_subject UUID, _viewer UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _visibility TEXT;
BEGIN
  IF _subject = _viewer THEN
    RETURN TRUE;
  END IF;

  SELECT online_visibility
  INTO _visibility
  FROM public.chat_user_privacy_settings
  WHERE user_id = _subject;

  IF _visibility IS NULL OR _visibility = 'everyone' THEN
    RETURN TRUE;
  END IF;

  IF _visibility = 'room_members' THEN
    RETURN public.chat_users_share_room(_subject, _viewer);
  END IF;

  RETURN FALSE;
END;
$$;

DROP POLICY IF EXISTS "presence_member_select" ON public.chat_presence;
CREATE POLICY "presence_member_select" ON public.chat_presence
  FOR SELECT TO authenticated
  USING (public.chat_can_view_presence(user_id, auth.uid()));

CREATE OR REPLACE FUNCTION public.chat_mark_room_read(
  _room_id UUID,
  _up_to_message_id UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _me UUID := auth.uid();
  _hide_receipts BOOLEAN := FALSE;
  _receipt_status TEXT := 'read';
BEGIN
  IF _me IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT hide_read_receipts
  INTO _hide_receipts
  FROM public.chat_user_privacy_settings
  WHERE user_id = _me;

  IF COALESCE(_hide_receipts, FALSE) THEN
    _receipt_status := 'delivered';
  END IF;

  INSERT INTO public.chat_message_receipts (message_id, room_id, user_id, status, updated_at)
  SELECT m.id, _room_id, _me, _receipt_status, now()
  FROM public.chat_messages m
  WHERE m.room_id = _room_id
    AND m.is_deleted = FALSE
    AND (_up_to_message_id IS NULL OR m.created_at <= (SELECT created_at FROM public.chat_messages WHERE id = _up_to_message_id))
  ON CONFLICT (message_id, user_id)
  DO UPDATE SET
    status = CASE
      WHEN excluded.status = 'read' THEN 'read'
      WHEN chat_message_receipts.status = 'read' THEN 'read'
      ELSE excluded.status
    END,
    updated_at = now();

  UPDATE public.chat_room_members
  SET last_read_message_id = COALESCE(
        _up_to_message_id,
        (SELECT id FROM public.chat_messages WHERE room_id = _room_id AND is_deleted = FALSE ORDER BY created_at DESC LIMIT 1)
      ),
      last_read_at = now()
  WHERE room_id = _room_id
    AND user_id = _me;
END;
$$;

CREATE OR REPLACE FUNCTION public.chat_set_typing(
  _room_id UUID,
  _is_typing BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _me UUID := auth.uid();
  _hide_typing BOOLEAN := FALSE;
BEGIN
  IF NOT public.fn_is_chat_member(_room_id, _me) THEN
    RAISE EXCEPTION 'Not a member';
  END IF;

  SELECT hide_typing
  INTO _hide_typing
  FROM public.chat_user_privacy_settings
  WHERE user_id = _me;

  INSERT INTO public.chat_typing_state (room_id, user_id, is_typing, expires_at, updated_at)
  VALUES (
    _room_id,
    _me,
    CASE WHEN COALESCE(_hide_typing, FALSE) THEN FALSE ELSE _is_typing END,
    now() + interval '8 seconds',
    now()
  )
  ON CONFLICT (room_id, user_id) DO UPDATE
    SET is_typing = EXCLUDED.is_typing,
        expires_at = EXCLUDED.expires_at,
        updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.chat_set_presence(
  _status TEXT DEFAULT 'online',
  _device_info JSONB DEFAULT '{}'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _me UUID := auth.uid();
  _settings public.chat_user_privacy_settings;
  _effective_status TEXT := _status;
BEGIN
  INSERT INTO public.chat_user_privacy_settings (user_id)
  VALUES (_me)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT *
  INTO _settings
  FROM public.chat_user_privacy_settings
  WHERE user_id = _me;

  IF COALESCE(_settings.invisible_mode, FALSE) OR COALESCE(_settings.online_visibility, 'everyone') = 'nobody' THEN
    _effective_status := 'offline';
  ELSIF COALESCE(_settings.hide_last_seen, FALSE) AND _status = 'away' THEN
    _effective_status := 'offline';
  END IF;

  INSERT INTO public.chat_presence (user_id, status, last_seen_at, device_info, updated_at)
  VALUES (
    _me,
    _effective_status,
    CASE WHEN COALESCE(_settings.hide_last_seen, FALSE) THEN NULL ELSE now() END,
    _device_info,
    now()
  )
  ON CONFLICT (user_id) DO UPDATE
    SET status = EXCLUDED.status,
        last_seen_at = EXCLUDED.last_seen_at,
        device_info = EXCLUDED.device_info,
        updated_at = now();
END;
$$;
