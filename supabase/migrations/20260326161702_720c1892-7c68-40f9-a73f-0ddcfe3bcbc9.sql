
-- ═══════════════════════════════════════════════════════════════
-- Messaging OS: RPCs + Triggers + Policy tightening
-- ═══════════════════════════════════════════════════════════════

-- Tighten the two overly-permissive INSERT policies
DROP POLICY IF EXISTS "os_rooms_insert" ON public.os_rooms;
CREATE POLICY "os_rooms_insert" ON public.os_rooms FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "os_audit_insert" ON public.os_audit_events;
CREATE POLICY "os_audit_insert" ON public.os_audit_events FOR INSERT
  WITH CHECK (actor_merchant_id = public.current_merchant_id());

-- ── RPC: os_record_presence ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.os_record_presence(
  _room_id uuid,
  _is_focused boolean,
  _last_read_message_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _mid TEXT := public.current_merchant_id();
BEGIN
  IF NOT public.is_os_room_member(_room_id) THEN
    RAISE EXCEPTION 'Not a member of this room';
  END IF;

  INSERT INTO public.os_room_presence (room_id, merchant_id, is_focused, last_read_message_id, last_seen_at)
  VALUES (_room_id, _mid, _is_focused, _last_read_message_id, now())
  ON CONFLICT (room_id, merchant_id)
  DO UPDATE SET
    is_focused = EXCLUDED.is_focused,
    last_read_message_id = COALESCE(EXCLUDED.last_read_message_id, os_room_presence.last_read_message_id),
    last_seen_at = now();
END;
$$;

-- ── RPC: os_get_unread_counts ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.os_get_unread_counts(
  _merchant_id text DEFAULT public.current_merchant_id()
)
RETURNS TABLE(room_id uuid, unread_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT m.room_id, COUNT(*) AS unread_count
  FROM public.os_messages m
  JOIN public.os_room_members rm ON rm.room_id = m.room_id AND rm.merchant_id = _merchant_id
  WHERE m.sender_merchant_id != _merchant_id
    AND m.read_at IS NULL
    AND (
      NOT EXISTS (
        SELECT 1 FROM public.os_room_presence p
        WHERE p.room_id = m.room_id
          AND p.merchant_id = _merchant_id
          AND p.is_focused = true
          AND p.last_seen_at > m.created_at - interval '10 seconds'
      )
    )
  GROUP BY m.room_id;
$$;

-- ── RPC: os_convert_message ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.os_convert_message(
  _message_id uuid,
  _target_type text,
  _payload jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _mid TEXT := public.current_merchant_id();
  _msg RECORD;
  _new_id uuid;
BEGIN
  SELECT room_id, content INTO _msg
  FROM public.os_messages WHERE id = _message_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'Message not found'; END IF;
  IF NOT public.is_os_room_member(_msg.room_id) THEN RAISE EXCEPTION 'Not a room member'; END IF;

  INSERT INTO public.os_business_objects (room_id, object_type, source_message_id, created_by_merchant_id, payload, status)
  VALUES (_msg.room_id, _target_type, _message_id, _mid, _payload || jsonb_build_object('source_content', _msg.content), 'pending')
  RETURNING id INTO _new_id;

  INSERT INTO public.os_audit_events (room_id, actor_merchant_id, event_type, target_type, target_id, metadata)
  VALUES (_msg.room_id, _mid, 'convert_message', 'business_object', _new_id,
    jsonb_build_object('source_message_id', _message_id, 'target_type', _target_type));

  RETURN _new_id;
END;
$$;

-- ── RPC: os_promote_thread ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.os_promote_thread(
  _room_id uuid,
  _source_message_ids uuid[],
  _routing_target text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _mid TEXT := public.current_merchant_id();
  _thread_id uuid;
BEGIN
  IF NOT public.is_os_room_member(_room_id) THEN RAISE EXCEPTION 'Not a room member'; END IF;

  INSERT INTO public.os_threads (room_id, source_message_ids, routing_target, created_by_merchant_id)
  VALUES (_room_id, _source_message_ids, _routing_target, _mid)
  RETURNING id INTO _thread_id;

  UPDATE public.os_messages SET thread_id = _thread_id
  WHERE id = ANY(_source_message_ids) AND room_id = _room_id;

  RETURN _thread_id;
END;
$$;

-- ── RPC: os_capture_snapshot ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.os_capture_snapshot(
  _target_business_object_id uuid,
  _trigger_event text
)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _mid TEXT := public.current_merchant_id();
  _bo RECORD;
  _hash text;
BEGIN
  SELECT * INTO _bo FROM public.os_business_objects WHERE id = _target_business_object_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Business object not found'; END IF;
  IF NOT public.is_os_room_member(_bo.room_id) THEN RAISE EXCEPTION 'Not a room member'; END IF;

  _hash := md5(_bo.payload::text || _bo.status || now()::text);

  UPDATE public.os_business_objects SET state_snapshot_hash = _hash, updated_at = now()
  WHERE id = _target_business_object_id;

  INSERT INTO public.os_business_objects (room_id, object_type, source_message_id, created_by_merchant_id, state_snapshot_hash, payload, status)
  VALUES (_bo.room_id, 'snapshot', _bo.source_message_id, _mid, _hash,
    jsonb_build_object('snapshot_of', _target_business_object_id, 'trigger', _trigger_event, 'frozen_payload', _bo.payload, 'frozen_status', _bo.status),
    'locked');

  INSERT INTO public.os_audit_events (room_id, actor_merchant_id, event_type, target_type, target_id, metadata)
  VALUES (_bo.room_id, _mid, 'capture_snapshot', 'business_object', _target_business_object_id,
    jsonb_build_object('hash', _hash, 'trigger', _trigger_event));

  RETURN _hash;
END;
$$;

-- ── RPC: os_send_notification ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.os_send_notification(
  _room_id uuid,
  _message_id uuid,
  _urgency text DEFAULT 'normal'
)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _msg RECORD;
  _sender_name TEXT;
  _count integer := 0;
  _member RECORD;
  _user_id uuid;
BEGIN
  SELECT sender_merchant_id, content INTO _msg
  FROM public.os_messages WHERE id = _message_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  SELECT COALESCE(nickname, display_name, merchant_id) INTO _sender_name
  FROM public.merchant_profiles WHERE merchant_id = _msg.sender_merchant_id LIMIT 1;

  FOR _member IN
    SELECT rm.merchant_id FROM public.os_room_members rm
    WHERE rm.room_id = _room_id AND rm.merchant_id != _msg.sender_merchant_id
  LOOP
    SELECT mp.user_id INTO _user_id
    FROM public.merchant_profiles mp WHERE mp.merchant_id = _member.merchant_id LIMIT 1;

    IF _user_id IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, category, title, body, entity_type, entity_id, anchor_id)
      VALUES (_user_id, 'message', COALESCE(_sender_name, 'Unknown'),
        LEFT(_msg.content, 100), 'os_room', _room_id::text, _message_id::text);
      _count := _count + 1;
    END IF;
  END LOOP;

  RETURN _count;
END;
$$;

-- ── Trigger: after insert on os_messages ────────────────────────
CREATE OR REPLACE FUNCTION public.os_after_message_insert()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  -- Audit event
  INSERT INTO public.os_audit_events (room_id, actor_merchant_id, event_type, target_type, target_id)
  VALUES (NEW.room_id, NEW.sender_merchant_id, 'message_sent', 'os_message', NEW.id);

  -- Notification dispatch
  PERFORM public.os_send_notification(NEW.room_id, NEW.id, 'normal');

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_os_after_message_insert ON public.os_messages;
CREATE TRIGGER trg_os_after_message_insert
  AFTER INSERT ON public.os_messages
  FOR EACH ROW EXECUTE FUNCTION public.os_after_message_insert();

-- ── Realtime ────────────────────────────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE public.os_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.os_business_objects;
