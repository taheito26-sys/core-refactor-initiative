-- Canonical direct room mapping to prevent duplicate merchant-to-merchant rooms
CREATE TABLE IF NOT EXISTS public.os_direct_rooms (
  merchant_a_id TEXT NOT NULL,
  merchant_b_id TEXT NOT NULL,
  room_id UUID NOT NULL REFERENCES public.os_rooms(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (merchant_a_id, merchant_b_id),
  UNIQUE (room_id),
  CHECK (merchant_a_id < merchant_b_id)
);

ALTER TABLE public.os_direct_rooms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Direct room map readable by participants" ON public.os_direct_rooms;
CREATE POLICY "Direct room map readable by participants"
  ON public.os_direct_rooms
  FOR SELECT
  TO authenticated
  USING (public.current_merchant_id() IN (merchant_a_id, merchant_b_id));

DROP POLICY IF EXISTS "Direct room map write via rpc only" ON public.os_direct_rooms;
CREATE POLICY "Direct room map write via rpc only"
  ON public.os_direct_rooms
  FOR ALL
  TO authenticated
  USING (false)
  WITH CHECK (false);

CREATE OR REPLACE FUNCTION public.fn_chat_get_or_create_direct_room(
  _counterparty_merchant_id TEXT,
  _room_title TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _self TEXT;
  _a TEXT;
  _b TEXT;
  _existing UUID;
  _new_room UUID;
BEGIN
  _self := public.current_merchant_id();
  IF _self IS NULL THEN
    RAISE EXCEPTION 'No merchant profile found for current user';
  END IF;

  IF _counterparty_merchant_id IS NULL OR btrim(_counterparty_merchant_id) = '' THEN
    RAISE EXCEPTION 'Counterparty merchant id is required';
  END IF;

  IF _counterparty_merchant_id = _self THEN
    RAISE EXCEPTION 'Cannot create direct room with self';
  END IF;

  IF _self < _counterparty_merchant_id THEN
    _a := _self;
    _b := _counterparty_merchant_id;
  ELSE
    _a := _counterparty_merchant_id;
    _b := _self;
  END IF;

  SELECT room_id INTO _existing
  FROM public.os_direct_rooms
  WHERE merchant_a_id = _a AND merchant_b_id = _b;

  IF _existing IS NULL THEN
    INSERT INTO public.os_rooms (name, type, lane, retention_policy, updated_at)
    VALUES (COALESCE(NULLIF(_room_title, ''), 'Direct Chat'), 'standard', 'Personal', 'indefinite', now())
    RETURNING id INTO _new_room;

    INSERT INTO public.os_direct_rooms (merchant_a_id, merchant_b_id, room_id)
    VALUES (_a, _b, _new_room)
    ON CONFLICT (merchant_a_id, merchant_b_id)
    DO UPDATE SET room_id = public.os_direct_rooms.room_id
    RETURNING room_id INTO _existing;

    IF _existing <> _new_room THEN
      DELETE FROM public.os_rooms WHERE id = _new_room;
    END IF;
  END IF;

  INSERT INTO public.os_room_members (room_id, merchant_id, role, joined_at)
  VALUES (_existing, _self, 'member', now())
  ON CONFLICT DO NOTHING;

  INSERT INTO public.os_room_members (room_id, merchant_id, role, joined_at)
  VALUES (_existing, _counterparty_merchant_id, 'member', now())
  ON CONFLICT DO NOTHING;

  UPDATE public.os_rooms SET updated_at = now() WHERE id = _existing;

  RETURN _existing;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_chat_get_or_create_direct_room(TEXT, TEXT) TO authenticated;

-- Ensure room summary only lists rooms where the current merchant is a member,
-- while making newly provisioned direct rooms visible to both participants.
CREATE OR REPLACE VIEW public.chat_room_summary_v WITH (security_invoker = true) AS
SELECT
  r.id,
  r.name,
  r.type,
  r.lane,
  r.updated_at AS last_message_at,
  r.security_policies,
  r.retention_policy,
  (SELECT count(*) FROM public.os_messages m WHERE m.room_id = r.id) AS message_count,
  (SELECT m.content FROM public.os_messages m WHERE m.room_id = r.id ORDER BY m.created_at DESC LIMIT 1) AS last_message_content,
  (SELECT m.sender_merchant_id FROM public.os_messages m WHERE m.room_id = r.id ORDER BY m.created_at DESC LIMIT 1) AS last_message_sender
FROM public.os_rooms r
WHERE EXISTS (
  SELECT 1
  FROM public.os_room_members rm
  WHERE rm.room_id = r.id
    AND rm.merchant_id = public.current_merchant_id()
);
