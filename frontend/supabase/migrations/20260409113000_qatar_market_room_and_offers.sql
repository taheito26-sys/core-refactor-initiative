DO $$
BEGIN
  ALTER TYPE public.chat_message_type ADD VALUE IF NOT EXISTS 'market_offer';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE public.market_offer_type AS ENUM ('buy', 'sell');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE public.market_offer_status AS ENUM ('active', 'filled', 'cancelled', 'expired');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.market_offers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id         UUID NOT NULL REFERENCES public.chat_rooms(id) ON DELETE CASCADE,
  message_id      UUID UNIQUE REFERENCES public.chat_messages(id) ON DELETE SET NULL,
  created_by      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  merchant_id     TEXT NOT NULL,
  offer_type      public.market_offer_type NOT NULL,
  asset           TEXT NOT NULL DEFAULT 'USDT',
  fiat_currency   TEXT NOT NULL DEFAULT 'QAR',
  amount          NUMERIC(18, 6) NOT NULL CHECK (amount > 0),
  price           NUMERIC(18, 6) NOT NULL CHECK (price > 0),
  min_amount      NUMERIC(18, 6),
  max_amount      NUMERIC(18, 6),
  payment_methods TEXT[] NOT NULL DEFAULT '{}',
  notes           TEXT,
  status          public.market_offer_status NOT NULL DEFAULT 'active',
  expires_at      TIMESTAMPTZ,
  cancelled_at    TIMESTAMPTZ,
  filled_at       TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (asset = 'USDT'),
  CHECK (fiat_currency = 'QAR'),
  CHECK (min_amount IS NULL OR min_amount > 0),
  CHECK (max_amount IS NULL OR max_amount > 0),
  CHECK (max_amount IS NULL OR min_amount IS NULL OR max_amount >= min_amount)
);

CREATE INDEX IF NOT EXISTS idx_market_offers_room_status
  ON public.market_offers(room_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_market_offers_creator
  ON public.market_offers(created_by, status, created_at DESC);

CREATE OR REPLACE FUNCTION public.update_market_offers_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_market_offers_updated_at ON public.market_offers;
CREATE TRIGGER trg_market_offers_updated_at
BEFORE UPDATE ON public.market_offers
FOR EACH ROW
EXECUTE FUNCTION public.update_market_offers_updated_at();

ALTER TABLE public.market_offers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "market_offers_member_select" ON public.market_offers;
CREATE POLICY "market_offers_member_select" ON public.market_offers
  FOR SELECT TO authenticated
  USING (public.fn_is_chat_member(room_id, auth.uid()));

DROP POLICY IF EXISTS "market_offers_creator_insert" ON public.market_offers;
CREATE POLICY "market_offers_creator_insert" ON public.market_offers
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND public.fn_is_chat_member(room_id, auth.uid())
  );

DROP POLICY IF EXISTS "market_offers_creator_update" ON public.market_offers;
CREATE POLICY "market_offers_creator_update" ON public.market_offers
  FOR UPDATE TO authenticated
  USING (
    created_by = auth.uid()
    AND public.fn_is_chat_member(room_id, auth.uid())
  )
  WITH CHECK (
    created_by = auth.uid()
    AND public.fn_is_chat_member(room_id, auth.uid())
  );

ALTER PUBLICATION supabase_realtime ADD TABLE public.market_offers;
ALTER TABLE public.market_offers REPLICA IDENTITY FULL;

CREATE OR REPLACE FUNCTION public.chat_active_merchant_id(p_user_id UUID DEFAULT auth.uid())
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT mp.merchant_id
  FROM public.merchant_profiles mp
  WHERE mp.user_id = p_user_id
    AND mp.status = 'active'
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.chat_ensure_qatar_market_room()
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _room_id UUID;
  _policy_id UUID;
BEGIN
  SELECT r.id
  INTO _room_id
  FROM public.chat_rooms r
  WHERE r.type = 'merchant_collab'
    AND r.name = 'Qatar P2P Market'
  LIMIT 1;

  IF _room_id IS NOT NULL THEN
    RETURN _room_id;
  END IF;

  SELECT id INTO _policy_id
  FROM public.chat_room_policies
  WHERE room_type = 'merchant_collab'
  LIMIT 1;

  INSERT INTO public.chat_rooms (
    type,
    name,
    description,
    created_by,
    policy_id,
    is_direct,
    is_announcement_only,
    metadata
  )
  VALUES (
    'merchant_collab',
    'Qatar P2P Market',
    'Permanent Qatar USDT trading room for active merchants',
    (SELECT user_id FROM public.merchant_profiles WHERE status = 'active' LIMIT 1),
    _policy_id,
    FALSE,
    FALSE,
    jsonb_build_object(
      'system_room', true,
      'market', 'Qatar P2P',
      'asset', 'USDT',
      'fiat_currency', 'QAR'
    )
  )
  RETURNING id INTO _room_id;

  RETURN _room_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.chat_sync_qatar_market_room_members()
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _room_id UUID;
BEGIN
  _room_id := public.chat_ensure_qatar_market_room();

  INSERT INTO public.chat_room_members (room_id, user_id, role, joined_at, updated_at, removed_at)
  SELECT
    _room_id,
    mp.user_id,
    'member'::public.chat_member_role,
    now(),
    now(),
    NULL
  FROM public.merchant_profiles mp
  WHERE mp.status = 'active'
    AND mp.user_id IS NOT NULL
  ON CONFLICT (room_id, user_id)
  DO UPDATE SET
    role = EXCLUDED.role,
    removed_at = NULL,
    updated_at = now();

  UPDATE public.chat_room_members m
  SET removed_at = now(),
      updated_at = now()
  WHERE m.room_id = _room_id
    AND m.removed_at IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.merchant_profiles mp
      WHERE mp.user_id = m.user_id
        AND mp.status = 'active'
    );

  RETURN _room_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.chat_sync_qatar_market_room_members_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.chat_sync_qatar_market_room_members();
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_chat_sync_qatar_market_room_members ON public.merchant_profiles;
CREATE TRIGGER trg_chat_sync_qatar_market_room_members
AFTER INSERT OR UPDATE OR DELETE ON public.merchant_profiles
FOR EACH STATEMENT
EXECUTE FUNCTION public.chat_sync_qatar_market_room_members_trigger();

SELECT public.chat_sync_qatar_market_room_members();

CREATE OR REPLACE FUNCTION public.chat_get_qatar_market_room()
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _me UUID := auth.uid();
  _room_id UUID;
  _merchant_id TEXT;
BEGIN
  _merchant_id := public.chat_active_merchant_id(_me);
  IF _merchant_id IS NULL THEN
    RAISE EXCEPTION 'Active merchant profile required';
  END IF;

  _room_id := public.chat_sync_qatar_market_room_members();

  INSERT INTO public.chat_room_members (room_id, user_id, role, updated_at, removed_at)
  VALUES (_room_id, _me, 'member', now(), NULL)
  ON CONFLICT (room_id, user_id)
  DO UPDATE SET
    role = 'member',
    removed_at = NULL,
    updated_at = now();

  RETURN _room_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.chat_create_market_offer(
  _room_id UUID,
  _offer_type public.market_offer_type,
  _amount NUMERIC,
  _price NUMERIC,
  _payment_methods TEXT[] DEFAULT '{}',
  _notes TEXT DEFAULT NULL,
  _min_amount NUMERIC DEFAULT NULL,
  _max_amount NUMERIC DEFAULT NULL,
  _expires_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS public.market_offers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _me UUID := auth.uid();
  _merchant_id TEXT;
  _offer public.market_offers;
  _message public.chat_messages;
BEGIN
  _merchant_id := public.chat_active_merchant_id(_me);
  IF _merchant_id IS NULL THEN
    RAISE EXCEPTION 'Active merchant profile required';
  END IF;

  IF _room_id <> public.chat_ensure_qatar_market_room() THEN
    RAISE EXCEPTION 'Market offers are only supported in Qatar P2P Market';
  END IF;

  IF NOT public.fn_is_chat_member(_room_id, _me) THEN
    RAISE EXCEPTION 'Not a room member';
  END IF;

  INSERT INTO public.market_offers (
    room_id,
    created_by,
    merchant_id,
    offer_type,
    amount,
    price,
    payment_methods,
    notes,
    min_amount,
    max_amount,
    expires_at
  )
  VALUES (
    _room_id,
    _me,
    _merchant_id,
    _offer_type,
    _amount,
    _price,
    COALESCE(_payment_methods, '{}'),
    NULLIF(trim(COALESCE(_notes, '')), ''),
    _min_amount,
    _max_amount,
    _expires_at
  )
  RETURNING * INTO _offer;

  SELECT *
  INTO _message
  FROM public.chat_send_message(
    _room_id,
    upper(_offer_type::TEXT) || ' ' || trim(to_char(_amount, 'FM999999999990.######')) || ' USDT @ ' || trim(to_char(_price, 'FM999999999990.######')) || ' QAR',
    'market_offer',
    jsonb_build_object(
      'market_offer', jsonb_build_object(
        'id', _offer.id,
        'offer_type', _offer.offer_type,
        'asset', _offer.asset,
        'fiat_currency', _offer.fiat_currency,
        'amount', _offer.amount,
        'price', _offer.price,
        'min_amount', _offer.min_amount,
        'max_amount', _offer.max_amount,
        'payment_methods', _offer.payment_methods,
        'notes', _offer.notes,
        'status', _offer.status,
        'merchant_id', _offer.merchant_id,
        'expires_at', _offer.expires_at
      )
    ),
    NULL,
    gen_random_uuid()::TEXT,
    _expires_at,
    FALSE,
    NULL
  )
  LIMIT 1;

  UPDATE public.market_offers
  SET message_id = _message.id
  WHERE id = _offer.id
  RETURNING * INTO _offer;

  RETURN _offer;
END;
$$;

CREATE OR REPLACE FUNCTION public.chat_cancel_market_offer(_offer_id UUID)
RETURNS public.market_offers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _me UUID := auth.uid();
  _offer public.market_offers;
BEGIN
  UPDATE public.market_offers
  SET status = 'cancelled',
      cancelled_at = now(),
      updated_at = now()
  WHERE id = _offer_id
    AND created_by = _me
    AND status = 'active'
  RETURNING * INTO _offer;

  IF _offer.id IS NULL THEN
    RAISE EXCEPTION 'Active offer not found';
  END IF;

  PERFORM public.chat_send_message(
    _offer.room_id,
    'Offer cancelled',
    'system',
    jsonb_build_object('market_offer_id', _offer.id, 'event', 'market_offer_cancelled'),
    NULL,
    gen_random_uuid()::TEXT,
    NULL,
    FALSE,
    NULL
  );

  RETURN _offer;
END;
$$;

CREATE OR REPLACE FUNCTION public.chat_get_rooms_v2()
RETURNS TABLE (
  room_id UUID,
  room_type public.chat_room_type,
  name TEXT,
  avatar_url TEXT,
  is_direct BOOLEAN,
  last_message_at TIMESTAMPTZ,
  last_message_preview TEXT,
  unread_count BIGINT,
  is_muted BOOLEAN,
  is_pinned BOOLEAN,
  is_archived BOOLEAN,
  member_count BIGINT,
  other_user_id UUID,
  other_user_metadata JSONB,
  policy JSONB
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    r.id AS room_id,
    r.type AS room_type,
    CASE
      WHEN r.is_direct AND other_mem.user_id IS NOT NULL THEN
        COALESCE(mp.display_name, p.full_name, p.email, r.name, 'Direct Message')
      ELSE r.name
    END AS name,
    r.avatar_url AS avatar_url,
    r.is_direct AS is_direct,
    r.last_message_at AS last_message_at,
    r.last_message_preview AS last_message_preview,
    CASE
      WHEN mem.last_read_at IS NULL THEN
        (
          SELECT COUNT(*)
          FROM public.chat_messages m
          WHERE m.room_id = r.id
            AND m.sender_id <> auth.uid()
            AND m.is_deleted = FALSE
        )
      ELSE
        (
          SELECT COUNT(*)
          FROM public.chat_messages m
          WHERE m.room_id = r.id
            AND m.sender_id <> auth.uid()
            AND m.is_deleted = FALSE
            AND m.created_at > mem.last_read_at
        )
    END AS unread_count,
    mem.is_muted AS is_muted,
    mem.is_pinned AS is_pinned,
    mem.is_archived AS is_archived,
    (
      SELECT COUNT(*)
      FROM public.chat_room_members m2
      WHERE m2.room_id = r.id
        AND m2.removed_at IS NULL
    ) AS member_count,
    other_mem.user_id AS other_user_id,
    CASE
      WHEN r.is_direct AND other_mem.user_id IS NOT NULL THEN
        jsonb_strip_nulls(
          jsonb_build_object(
            'display_name', COALESCE(mp.display_name, p.full_name, p.email),
            'avatar_url', p.avatar_url,
            'merchant_id', mp.merchant_id
          )
        )
      ELSE '{}'::jsonb
    END AS other_user_metadata,
    jsonb_build_object(
      'id', pol.id,
      'room_type', pol.room_type,
      'encryption_mode', pol.encryption_mode,
      'retention_hours', pol.retention_hours,
      'allow_files', pol.allow_files,
      'allow_voice_notes', pol.allow_voice_notes,
      'allow_images', pol.allow_images,
      'allow_calls', pol.allow_calls,
      'allow_group_calls', pol.allow_group_calls,
      'moderation_level', pol.moderation_level,
      'history_searchable', pol.history_searchable,
      'watermark_enabled', pol.watermark_enabled,
      'disappearing_default_hours', pol.disappearing_default_hours,
      'max_file_size_mb', pol.max_file_size_mb,
      'allowed_mime_types', pol.allowed_mime_types,
      'screenshot_protection', pol.screenshot_protection,
      'link_preview_enabled', pol.link_preview_enabled
    ) AS policy
  FROM public.chat_rooms r
  JOIN public.chat_room_members mem
    ON mem.room_id = r.id
   AND mem.user_id = auth.uid()
   AND mem.removed_at IS NULL
  LEFT JOIN LATERAL (
    SELECT m2.user_id
    FROM public.chat_room_members m2
    WHERE r.is_direct = TRUE
      AND m2.room_id = r.id
      AND m2.user_id <> auth.uid()
      AND m2.removed_at IS NULL
    LIMIT 1
  ) AS other_mem ON TRUE
  LEFT JOIN public.merchant_profiles mp
    ON mp.user_id = other_mem.user_id
  LEFT JOIN public.profiles p
    ON p.user_id = other_mem.user_id
  LEFT JOIN public.chat_room_policies pol
    ON pol.id = r.policy_id
  WHERE mem.is_archived = FALSE
  ORDER BY COALESCE(r.last_message_at, r.created_at) DESC, r.id;
$$;

CREATE OR REPLACE FUNCTION public.chat_mark_viewed(_message_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _me UUID := auth.uid();
BEGIN
  UPDATE public.chat_messages
  SET viewed_by = CASE
                    WHEN _me = ANY(viewed_by) THEN viewed_by
                    ELSE array_append(viewed_by, _me)
                  END,
      expires_at = CASE
                     WHEN view_once = TRUE THEN now()
                     ELSE expires_at
                   END,
      content = CASE
                  WHEN view_once = TRUE THEN '[view once consumed]'
                  ELSE content
                END,
      metadata = CASE
                   WHEN view_once = TRUE THEN COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('view_once_consumed', true, 'consumed_at', now())
                   ELSE metadata
                 END,
      updated_at = now()
  WHERE id = _message_id
    AND view_once = TRUE
    AND NOT (_me = ANY(viewed_by));
END;
$$;
