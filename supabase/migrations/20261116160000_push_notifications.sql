-- Push notifications: device/browser registration, delivery preferences and
-- server-side dispatch.
--
-- The client already contained push registration and a push-send edge
-- function, but the live database never had the supporting tables and nothing
-- called push-send when a notification was created. This migration closes that
-- gap:
--   * push_device_tokens / web_push_subscriptions store delivery endpoints
--   * notification_settings holds the master switch, quiet hours and presence
--   * notification_reminders restores the table the reminders cron expects
--   * an AFTER INSERT trigger on notifications asks push-send to deliver it

-- ── Device tokens (FCM / APNs) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.push_device_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token text NOT NULL,
  platform text NOT NULL DEFAULT 'web',
  device_id text,
  active_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- A legacy copy of this table may predate per-device presence.
ALTER TABLE public.push_device_tokens
  ADD COLUMN IF NOT EXISTS active_until timestamptz;

-- One physical device belongs to exactly one signed-in account at a time.
DELETE FROM public.push_device_tokens a
USING public.push_device_tokens b
WHERE a.token = b.token AND a.id < b.id;

CREATE UNIQUE INDEX IF NOT EXISTS push_device_tokens_token_uidx
  ON public.push_device_tokens (token);
CREATE INDEX IF NOT EXISTS push_device_tokens_user_idx
  ON public.push_device_tokens (user_id);

ALTER TABLE public.push_device_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own push tokens" ON public.push_device_tokens;
CREATE POLICY "Users can view own push tokens" ON public.push_device_tokens
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can insert own push tokens" ON public.push_device_tokens;
CREATE POLICY "Users can insert own push tokens" ON public.push_device_tokens
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can update own push tokens" ON public.push_device_tokens;
CREATE POLICY "Users can update own push tokens" ON public.push_device_tokens
  FOR UPDATE TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can delete own push tokens" ON public.push_device_tokens;
CREATE POLICY "Users can delete own push tokens" ON public.push_device_tokens
  FOR DELETE TO authenticated USING (user_id = auth.uid());

DROP TRIGGER IF EXISTS update_push_device_tokens_updated_at ON public.push_device_tokens;
CREATE TRIGGER update_push_device_tokens_updated_at
  BEFORE UPDATE ON public.push_device_tokens
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── Browser Web Push subscriptions ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.web_push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint text NOT NULL,
  p256dh text NOT NULL,
  auth text NOT NULL,
  user_agent text,
  active_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.web_push_subscriptions
  ADD COLUMN IF NOT EXISTS active_until timestamptz;
ALTER TABLE public.web_push_subscriptions
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz NOT NULL DEFAULT now();

DELETE FROM public.web_push_subscriptions a
USING public.web_push_subscriptions b
WHERE a.endpoint = b.endpoint AND a.id < b.id;

CREATE UNIQUE INDEX IF NOT EXISTS web_push_subscriptions_endpoint_uidx
  ON public.web_push_subscriptions (endpoint);
CREATE INDEX IF NOT EXISTS web_push_subscriptions_user_idx
  ON public.web_push_subscriptions (user_id);

ALTER TABLE public.web_push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own web push subscriptions" ON public.web_push_subscriptions;
CREATE POLICY "Users can view own web push subscriptions" ON public.web_push_subscriptions
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can insert own web push subscriptions" ON public.web_push_subscriptions;
CREATE POLICY "Users can insert own web push subscriptions" ON public.web_push_subscriptions
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can update own web push subscriptions" ON public.web_push_subscriptions;
CREATE POLICY "Users can update own web push subscriptions" ON public.web_push_subscriptions
  FOR UPDATE TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can delete own web push subscriptions" ON public.web_push_subscriptions;
CREATE POLICY "Users can delete own web push subscriptions" ON public.web_push_subscriptions
  FOR DELETE TO authenticated USING (user_id = auth.uid());

DROP TRIGGER IF EXISTS update_web_push_subscriptions_updated_at ON public.web_push_subscriptions;
CREATE TRIGGER update_web_push_subscriptions_updated_at
  BEFORE UPDATE ON public.web_push_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── Per-user notification settings (master switch, quiet hours, presence) ──
CREATE TABLE IF NOT EXISTS public.notification_settings (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  push_enabled boolean NOT NULL DEFAULT true,
  dnd_enabled boolean NOT NULL DEFAULT false,
  dnd_start time NOT NULL DEFAULT '22:00',
  dnd_end time NOT NULL DEFAULT '07:00',
  timezone text NOT NULL DEFAULT 'UTC',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.notification_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own notification settings" ON public.notification_settings;
CREATE POLICY "Users can view own notification settings" ON public.notification_settings
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can insert own notification settings" ON public.notification_settings;
CREATE POLICY "Users can insert own notification settings" ON public.notification_settings
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can update own notification settings" ON public.notification_settings;
CREATE POLICY "Users can update own notification settings" ON public.notification_settings
  FOR UPDATE TO authenticated USING (user_id = auth.uid());

DROP TRIGGER IF EXISTS update_notification_settings_updated_at ON public.notification_settings;
CREATE TRIGGER update_notification_settings_updated_at
  BEFORE UPDATE ON public.notification_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── Reminders table (referenced by the notification-reminders cron) ────────
CREATE TABLE IF NOT EXISTS public.notification_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  entity_type text,
  entity_id text,
  source_notification_id uuid REFERENCES public.notifications(id) ON DELETE CASCADE,
  remind_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.notification_reminders
  ADD COLUMN IF NOT EXISTS source_notification_id uuid;
ALTER TABLE public.notification_reminders
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
ALTER TABLE public.notification_reminders
  ADD COLUMN IF NOT EXISTS sent_at timestamptz;

CREATE INDEX IF NOT EXISTS notification_reminders_due_idx
  ON public.notification_reminders (sent_at, remind_at);
CREATE INDEX IF NOT EXISTS notification_reminders_user_idx
  ON public.notification_reminders (user_id);

ALTER TABLE public.notification_reminders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own reminders" ON public.notification_reminders;
CREATE POLICY "Users can view own reminders" ON public.notification_reminders
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can insert own reminders" ON public.notification_reminders;
CREATE POLICY "Users can insert own reminders" ON public.notification_reminders
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can update own reminders" ON public.notification_reminders;
CREATE POLICY "Users can update own reminders" ON public.notification_reminders
  FOR UPDATE TO authenticated USING (user_id = auth.uid());

-- ── Private dispatch configuration ─────────────────────────────────────────
-- Holds the shared secret used by the notifications trigger, plus the VAPID
-- key pair. The key pair is generated by push-send on first use so no private
-- key is ever committed to the repository.
CREATE TABLE IF NOT EXISTS public.push_dispatch_config (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  webhook_secret text NOT NULL,
  vapid_public_key text,
  vapid_private_key text,
  vapid_subject text NOT NULL DEFAULT 'https://qtrp2ptracker.vercel.app',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.push_dispatch_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.push_dispatch_config FROM anon, authenticated;

INSERT INTO public.push_dispatch_config (id, webhook_secret)
VALUES (true, encode(gen_random_bytes(32), 'hex'))
ON CONFLICT (id) DO NOTHING;

-- ── Registration RPCs ──────────────────────────────────────────────────────
-- A token/subscription identifies one physical browser or device. These
-- functions move it to the account that has just signed in, so a shared device
-- never keeps receiving pushes for a previous user.
CREATE OR REPLACE FUNCTION public.register_push_token(
  _token text,
  _platform text,
  _device_id text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF _token IS NULL OR length(trim(_token)) = 0 THEN
    RAISE EXCEPTION 'token required';
  END IF;

  DELETE FROM public.push_device_tokens
  WHERE token = _token AND user_id <> auth.uid();

  INSERT INTO public.push_device_tokens (user_id, token, platform, device_id)
  VALUES (auth.uid(), _token, COALESCE(NULLIF(_platform, ''), 'web'), _device_id)
  ON CONFLICT (token) DO UPDATE
    SET user_id = auth.uid(),
        platform = EXCLUDED.platform,
        device_id = EXCLUDED.device_id,
        updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.unregister_push_token(_token text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;
  DELETE FROM public.push_device_tokens
  WHERE token = _token AND user_id = auth.uid();
END;
$$;

CREATE OR REPLACE FUNCTION public.register_web_push_subscription(
  _endpoint text,
  _p256dh text,
  _auth_key text,
  _user_agent text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF _endpoint IS NULL OR _p256dh IS NULL OR _auth_key IS NULL THEN
    RAISE EXCEPTION 'subscription keys required';
  END IF;

  DELETE FROM public.web_push_subscriptions
  WHERE endpoint = _endpoint AND user_id <> auth.uid();

  INSERT INTO public.web_push_subscriptions
    (user_id, endpoint, p256dh, auth, user_agent)
  VALUES
    (auth.uid(), _endpoint, _p256dh, _auth_key, _user_agent)
  ON CONFLICT (endpoint) DO UPDATE
    SET user_id = auth.uid(),
        p256dh = EXCLUDED.p256dh,
        auth = EXCLUDED.auth,
        user_agent = EXCLUDED.user_agent,
        last_seen_at = now(),
        updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.unregister_web_push_subscription(_endpoint text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;
  DELETE FROM public.web_push_subscriptions
  WHERE endpoint = _endpoint AND user_id = auth.uid();
END;
$$;

CREATE OR REPLACE FUNCTION public.set_notification_presence(
  _active boolean,
  _endpoint text DEFAULT NULL,
  _token text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_until timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;

  v_until := CASE WHEN _active THEN now() + interval '90 seconds' ELSE NULL END;

  IF _endpoint IS NOT NULL THEN
    UPDATE public.web_push_subscriptions
    SET active_until = v_until, updated_at = now()
    WHERE endpoint = _endpoint AND user_id = auth.uid();
  ELSIF _token IS NOT NULL THEN
    UPDATE public.push_device_tokens
    SET active_until = v_until, updated_at = now()
    WHERE token = _token AND user_id = auth.uid();
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.register_push_token(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unregister_push_token(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.register_web_push_subscription(text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unregister_web_push_subscription(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_notification_presence(boolean, text, text) TO authenticated;

-- ── Dispatch trigger ───────────────────────────────────────────────────────
-- pg_net is asynchronous, so notification inserts are never blocked by a slow
-- push provider. Any failure is swallowed: a notification must still be saved
-- even if the push network is unavailable.
CREATE OR REPLACE FUNCTION public.dispatch_notification_push()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, net
AS $$
DECLARE
  v_secret text;
BEGIN
  SELECT webhook_secret INTO v_secret
  FROM public.push_dispatch_config
  WHERE id = true;

  IF v_secret IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := 'https://uqinpckirpatvkxyizqf.supabase.co/functions/v1/push-send',
    body := jsonb_build_object('notification_id', NEW.id),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-push-secret', v_secret
    ),
    timeout_milliseconds := 5000
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'push dispatch failed for notification %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notifications_dispatch_push ON public.notifications;
CREATE TRIGGER trg_notifications_dispatch_push
  AFTER INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.dispatch_notification_push();

NOTIFY pgrst, 'reload schema';
