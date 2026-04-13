
-- Add missing columns to chat_privacy_settings
ALTER TABLE public.chat_privacy_settings
  ADD COLUMN IF NOT EXISTS notification_preview text NOT NULL DEFAULT 'full',
  ADD COLUMN IF NOT EXISTS show_sender_in_notification boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS anonymous_mode boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS screenshot_protection boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS watermark_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS forwarding_disabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS copy_disabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS export_disabled boolean NOT NULL DEFAULT false;

-- Recreate chat_get_privacy_settings to return all columns
CREATE OR REPLACE FUNCTION public.chat_get_privacy_settings()
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE
  _me UUID := auth.uid();
  _row public.chat_privacy_settings%ROWTYPE;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  INSERT INTO public.chat_privacy_settings (user_id) VALUES (_me)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT * INTO _row FROM public.chat_privacy_settings WHERE user_id = _me;

  RETURN jsonb_build_object(
    'user_id', _row.user_id,
    'hide_read_receipts', _row.hide_read_receipts,
    'hide_last_seen', _row.hide_last_seen,
    'hide_typing', _row.hide_typing,
    'invisible_mode', _row.invisible_mode,
    'online_visibility', _row.online_visibility,
    'notification_preview', _row.notification_preview,
    'show_sender_in_notification', _row.show_sender_in_notification,
    'anonymous_mode', _row.anonymous_mode,
    'screenshot_protection', _row.screenshot_protection,
    'watermark_enabled', _row.watermark_enabled,
    'forwarding_disabled', _row.forwarding_disabled,
    'copy_disabled', _row.copy_disabled,
    'export_disabled', _row.export_disabled,
    'updated_at', _row.updated_at
  );
END;
$function$;

-- Recreate chat_update_privacy_settings with all parameters
CREATE OR REPLACE FUNCTION public.chat_update_privacy_settings(
  _hide_read_receipts boolean DEFAULT NULL,
  _hide_last_seen boolean DEFAULT NULL,
  _hide_typing boolean DEFAULT NULL,
  _invisible_mode boolean DEFAULT NULL,
  _online_visibility text DEFAULT NULL,
  _notification_preview text DEFAULT NULL,
  _show_sender_in_notification boolean DEFAULT NULL,
  _anonymous_mode boolean DEFAULT NULL,
  _screenshot_protection boolean DEFAULT NULL,
  _watermark_enabled boolean DEFAULT NULL,
  _forwarding_disabled boolean DEFAULT NULL,
  _copy_disabled boolean DEFAULT NULL,
  _export_disabled boolean DEFAULT NULL
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE
  _me UUID := auth.uid();
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  INSERT INTO public.chat_privacy_settings (user_id) VALUES (_me)
  ON CONFLICT (user_id) DO NOTHING;

  UPDATE public.chat_privacy_settings SET
    hide_read_receipts          = COALESCE(_hide_read_receipts, hide_read_receipts),
    hide_last_seen              = COALESCE(_hide_last_seen, hide_last_seen),
    hide_typing                 = COALESCE(_hide_typing, hide_typing),
    invisible_mode              = COALESCE(_invisible_mode, invisible_mode),
    online_visibility           = COALESCE(_online_visibility, online_visibility),
    notification_preview        = COALESCE(_notification_preview, notification_preview),
    show_sender_in_notification = COALESCE(_show_sender_in_notification, show_sender_in_notification),
    anonymous_mode              = COALESCE(_anonymous_mode, anonymous_mode),
    screenshot_protection       = COALESCE(_screenshot_protection, screenshot_protection),
    watermark_enabled           = COALESCE(_watermark_enabled, watermark_enabled),
    forwarding_disabled         = COALESCE(_forwarding_disabled, forwarding_disabled),
    copy_disabled               = COALESCE(_copy_disabled, copy_disabled),
    export_disabled             = COALESCE(_export_disabled, export_disabled),
    updated_at                  = now()
  WHERE user_id = _me;

  RETURN public.chat_get_privacy_settings();
END;
$function$;
