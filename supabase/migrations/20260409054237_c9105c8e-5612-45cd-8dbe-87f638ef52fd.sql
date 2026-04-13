
-- ════════════════════════════════════════════════════════════════════════
-- 1. market_offers table
-- ════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.market_offers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id       UUID NOT NULL REFERENCES public.chat_rooms(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL,
  merchant_id   TEXT NOT NULL,
  offer_type    TEXT NOT NULL CHECK (offer_type IN ('buy','sell')),
  currency_pair TEXT NOT NULL DEFAULT 'USDT/QAR',
  rate          NUMERIC(18,6) NOT NULL,
  min_amount    NUMERIC(18,6) NOT NULL DEFAULT 0,
  max_amount    NUMERIC(18,6) NOT NULL DEFAULT 0,
  note          TEXT,
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled','expired','filled')),
  expires_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mo_room     ON public.market_offers(room_id);
CREATE INDEX IF NOT EXISTS idx_mo_user     ON public.market_offers(user_id);
CREATE INDEX IF NOT EXISTS idx_mo_status   ON public.market_offers(status);
CREATE INDEX IF NOT EXISTS idx_mo_merchant ON public.market_offers(merchant_id);

ALTER TABLE public.market_offers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mo_select" ON public.market_offers FOR SELECT
  USING (public.fn_is_chat_member(room_id, auth.uid()));

CREATE POLICY "mo_insert" ON public.market_offers FOR INSERT
  WITH CHECK (user_id = auth.uid() AND public.fn_is_chat_member(room_id, auth.uid()));

CREATE POLICY "mo_update" ON public.market_offers FOR UPDATE
  USING (user_id = auth.uid());

ALTER PUBLICATION supabase_realtime ADD TABLE public.market_offers;

-- ════════════════════════════════════════════════════════════════════════
-- 2. chat_privacy_settings table
-- ════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.chat_privacy_settings (
  user_id            UUID PRIMARY KEY,
  invisible_mode     BOOLEAN NOT NULL DEFAULT false,
  hide_typing        BOOLEAN NOT NULL DEFAULT false,
  hide_read_receipts BOOLEAN NOT NULL DEFAULT false,
  hide_last_seen     BOOLEAN NOT NULL DEFAULT false,
  online_visibility  TEXT NOT NULL DEFAULT 'everyone' CHECK (online_visibility IN ('everyone','contacts','nobody')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.chat_privacy_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cps_select_own" ON public.chat_privacy_settings FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "cps_insert_own" ON public.chat_privacy_settings FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "cps_update_own" ON public.chat_privacy_settings FOR UPDATE
  USING (user_id = auth.uid());

-- Internal helper: read another user's privacy settings (security definer)
CREATE OR REPLACE FUNCTION public.fn_get_user_privacy(p_user_id UUID)
RETURNS public.chat_privacy_settings
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM public.chat_privacy_settings WHERE user_id = p_user_id LIMIT 1;
$$;

-- ════════════════════════════════════════════════════════════════════════
-- 3. chat_get_qatar_market_room()
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.chat_get_qatar_market_room()
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.chat_rooms
  WHERE type = 'merchant_collab'
  ORDER BY created_at ASC LIMIT 1;
$$;

-- ════════════════════════════════════════════════════════════════════════
-- 4. chat_create_market_offer(...)
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.chat_create_market_offer(
  _offer_type TEXT,
  _rate NUMERIC,
  _min_amount NUMERIC DEFAULT 0,
  _max_amount NUMERIC DEFAULT 0,
  _currency_pair TEXT DEFAULT 'USDT/QAR',
  _note TEXT DEFAULT NULL,
  _expires_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _me UUID := auth.uid();
  _room_id UUID;
  _mid TEXT;
  _offer_id UUID;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT public.chat_get_qatar_market_room() INTO _room_id;
  IF _room_id IS NULL THEN RAISE EXCEPTION 'Qatar P2P Market room not found'; END IF;

  IF NOT public.fn_is_chat_member(_room_id, _me) THEN
    RAISE EXCEPTION 'Not a member of the market room';
  END IF;

  SELECT merchant_id INTO _mid FROM public.merchant_profiles WHERE user_id = _me AND status = 'active' LIMIT 1;
  IF _mid IS NULL THEN RAISE EXCEPTION 'No active merchant profile'; END IF;

  INSERT INTO public.market_offers (room_id, user_id, merchant_id, offer_type, rate, min_amount, max_amount, currency_pair, note, expires_at)
  VALUES (_room_id, _me, _mid, _offer_type, _rate, _min_amount, _max_amount, _currency_pair, _note, _expires_at)
  RETURNING id INTO _offer_id;

  RETURN _offer_id;
END;
$$;

-- ════════════════════════════════════════════════════════════════════════
-- 5. chat_cancel_market_offer(_offer_id)
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.chat_cancel_market_offer(_offer_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _me UUID := auth.uid();
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  UPDATE public.market_offers
  SET status = 'cancelled', updated_at = now()
  WHERE id = _offer_id AND user_id = _me AND status = 'active';

  IF NOT FOUND THEN RAISE EXCEPTION 'Offer not found or not cancellable'; END IF;
END;
$$;

-- ════════════════════════════════════════════════════════════════════════
-- 6. chat_get_rooms_v2()
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.chat_get_rooms_v2()
RETURNS TABLE (
  room_id UUID,
  room_name TEXT,
  room_type TEXT,
  is_direct BOOLEAN,
  last_message_at TIMESTAMPTZ,
  last_message_preview TEXT,
  unread_count BIGINT,
  my_role TEXT,
  is_muted BOOLEAN,
  is_pinned BOOLEAN,
  is_archived BOOLEAN
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
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
      ), 0) AS unread_count,
      mem.role::text,
      mem.is_muted,
      mem.is_pinned,
      mem.is_archived
    FROM public.chat_rooms r
    JOIN public.chat_room_members mem ON mem.room_id = r.id AND mem.user_id = _me AND mem.removed_at IS NULL
    ORDER BY COALESCE(r.last_message_at, r.created_at) DESC;
END;
$$;

-- ════════════════════════════════════════════════════════════════════════
-- 7. chat_get_privacy_settings()
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.chat_get_privacy_settings()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _me UUID := auth.uid();
  _result JSONB;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT jsonb_build_object(
    'invisible_mode', COALESCE(s.invisible_mode, false),
    'hide_typing', COALESCE(s.hide_typing, false),
    'hide_read_receipts', COALESCE(s.hide_read_receipts, false),
    'hide_last_seen', COALESCE(s.hide_last_seen, false),
    'online_visibility', COALESCE(s.online_visibility, 'everyone')
  ) INTO _result
  FROM public.chat_privacy_settings s WHERE s.user_id = _me;

  IF _result IS NULL THEN
    _result := '{"invisible_mode":false,"hide_typing":false,"hide_read_receipts":false,"hide_last_seen":false,"online_visibility":"everyone"}'::jsonb;
  END IF;

  RETURN _result;
END;
$$;

-- ════════════════════════════════════════════════════════════════════════
-- 8. chat_update_privacy_settings(...)
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.chat_update_privacy_settings(
  _invisible_mode BOOLEAN DEFAULT NULL,
  _hide_typing BOOLEAN DEFAULT NULL,
  _hide_read_receipts BOOLEAN DEFAULT NULL,
  _hide_last_seen BOOLEAN DEFAULT NULL,
  _online_visibility TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _me UUID := auth.uid();
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  INSERT INTO public.chat_privacy_settings (user_id) VALUES (_me)
  ON CONFLICT (user_id) DO NOTHING;

  UPDATE public.chat_privacy_settings SET
    invisible_mode     = COALESCE(_invisible_mode, invisible_mode),
    hide_typing        = COALESCE(_hide_typing, hide_typing),
    hide_read_receipts = COALESCE(_hide_read_receipts, hide_read_receipts),
    hide_last_seen     = COALESCE(_hide_last_seen, hide_last_seen),
    online_visibility  = COALESCE(_online_visibility, online_visibility),
    updated_at         = now()
  WHERE user_id = _me;

  RETURN public.chat_get_privacy_settings();
END;
$$;

-- ════════════════════════════════════════════════════════════════════════
-- 9. Updated chat_mark_room_read — respects hide_read_receipts
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.chat_mark_room_read(_room_id UUID, _up_to_message_id UUID DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _me UUID := auth.uid();
  _hide BOOLEAN;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT COALESCE(s.hide_read_receipts, false) INTO _hide
  FROM public.chat_privacy_settings s WHERE s.user_id = _me;

  -- Always update own member record
  UPDATE public.chat_room_members SET
    last_read_message_id = COALESCE(_up_to_message_id,
      (SELECT id FROM public.chat_messages WHERE room_id = _room_id AND is_deleted = FALSE ORDER BY created_at DESC LIMIT 1)),
    last_read_at = now()
  WHERE room_id = _room_id AND user_id = _me;

  -- Only write receipts if not hiding
  IF NOT COALESCE(_hide, false) THEN
    INSERT INTO public.chat_message_receipts (message_id, room_id, user_id, status, updated_at)
    SELECT m.id, _room_id, _me, 'read', now()
    FROM public.chat_messages m
    WHERE m.room_id = _room_id AND m.is_deleted = FALSE
      AND (_up_to_message_id IS NULL OR m.created_at <= (SELECT created_at FROM public.chat_messages WHERE id = _up_to_message_id))
    ON CONFLICT (message_id, user_id) DO UPDATE SET status = 'read', updated_at = now()
    WHERE chat_message_receipts.status <> 'read';
  END IF;
END;
$$;

-- ════════════════════════════════════════════════════════════════════════
-- 10. Updated chat_set_typing — respects hide_typing
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.chat_set_typing(_room_id UUID, _is_typing BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _me UUID := auth.uid();
  _hide BOOLEAN;
BEGIN
  IF NOT public.fn_is_chat_member(_room_id, _me) THEN RAISE EXCEPTION 'Not a member'; END IF;

  SELECT COALESCE(s.hide_typing, false) INTO _hide
  FROM public.chat_privacy_settings s WHERE s.user_id = _me;

  IF COALESCE(_hide, false) THEN RETURN; END IF;

  INSERT INTO public.chat_typing_state (room_id, user_id, is_typing, expires_at, updated_at)
  VALUES (_room_id, _me, _is_typing, now() + interval '8 seconds', now())
  ON CONFLICT (room_id, user_id) DO UPDATE SET is_typing = EXCLUDED.is_typing, expires_at = EXCLUDED.expires_at, updated_at = now();
END;
$$;

-- ════════════════════════════════════════════════════════════════════════
-- 11. Updated chat_set_presence — respects invisible_mode, online_visibility, hide_last_seen
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.chat_set_presence(_status TEXT DEFAULT 'online', _device_info JSONB DEFAULT '{}'::JSONB)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _me UUID := auth.uid();
  _priv public.chat_privacy_settings;
  _effective_status TEXT;
BEGIN
  IF _me IS NULL THEN RETURN; END IF;

  SELECT * INTO _priv FROM public.chat_privacy_settings WHERE user_id = _me;

  -- If invisible mode, always store offline
  IF COALESCE(_priv.invisible_mode, false) THEN
    _effective_status := 'offline';
  ELSE
    _effective_status := _status;
  END IF;

  INSERT INTO public.chat_presence (user_id, status, last_seen_at, device_info, updated_at)
  VALUES (
    _me,
    _effective_status,
    CASE WHEN COALESCE(_priv.hide_last_seen, false) THEN '1970-01-01'::timestamptz ELSE now() END,
    _device_info,
    now()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    status = EXCLUDED.status,
    last_seen_at = EXCLUDED.last_seen_at,
    device_info = EXCLUDED.device_info,
    updated_at = now();
END;
$$;

-- ════════════════════════════════════════════════════════════════════════
-- 12. Viewer-aware presence RLS
-- ════════════════════════════════════════════════════════════════════════
-- Helper to check if a user is visible to the viewer
CREATE OR REPLACE FUNCTION public.fn_is_presence_visible(_target_user_id UUID, _viewer_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _priv public.chat_privacy_settings;
  _shares_room BOOLEAN;
BEGIN
  -- Always visible to self
  IF _target_user_id = _viewer_id THEN RETURN true; END IF;

  SELECT * INTO _priv FROM public.chat_privacy_settings WHERE user_id = _target_user_id;

  -- No privacy settings = visible to all
  IF NOT FOUND THEN RETURN true; END IF;

  -- Invisible mode = hidden from everyone
  IF _priv.invisible_mode THEN RETURN false; END IF;

  -- Check online_visibility
  IF _priv.online_visibility = 'everyone' THEN RETURN true; END IF;

  IF _priv.online_visibility = 'nobody' THEN RETURN false; END IF;

  -- 'contacts' = shares at least one chat room
  SELECT EXISTS (
    SELECT 1 FROM public.chat_room_members a
    JOIN public.chat_room_members b ON a.room_id = b.room_id
    WHERE a.user_id = _target_user_id AND b.user_id = _viewer_id
      AND a.removed_at IS NULL AND b.removed_at IS NULL
  ) INTO _shares_room;

  RETURN _shares_room;
END;
$$;

-- Replace the open presence_member_select with viewer-aware policy
DROP POLICY IF EXISTS "presence_member_select" ON public.chat_presence;
CREATE POLICY "presence_member_select" ON public.chat_presence FOR SELECT
  TO authenticated
  USING (public.fn_is_presence_visible(user_id, auth.uid()));
