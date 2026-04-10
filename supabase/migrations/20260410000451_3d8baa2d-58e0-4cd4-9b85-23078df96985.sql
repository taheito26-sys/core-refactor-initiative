
-- 1. Add signaling_channel column to chat_calls
ALTER TABLE public.chat_calls
  ADD COLUMN IF NOT EXISTS signaling_channel TEXT DEFAULT 'supabase';

-- 2. RLS policy for chat_call_participants self-update
DROP POLICY IF EXISTS "participants_self_update" ON public.chat_call_participants;
CREATE POLICY "participants_self_update" ON public.chat_call_participants
  FOR UPDATE USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- 3. Modify chat_initiate_call to accept optional pre-generated call ID and ice_config
CREATE OR REPLACE FUNCTION public.chat_initiate_call(
  _room_id   UUID,
  _call_id   UUID    DEFAULT NULL,
  _ice_config JSONB  DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _me UUID := auth.uid(); _policy RECORD;
BEGIN
  IF _call_id IS NULL THEN _call_id := gen_random_uuid(); END IF;

  SELECT p.allow_calls INTO _policy FROM public.chat_rooms r JOIN public.chat_room_policies p ON p.id = r.policy_id WHERE r.id = _room_id;
  IF NOT _policy.allow_calls THEN RAISE EXCEPTION 'Calls not permitted'; END IF;
  IF NOT public.fn_is_chat_member(_room_id, _me) THEN RAISE EXCEPTION 'Not a member'; END IF;

  UPDATE public.chat_calls SET status = 'missed', ended_at = now() WHERE room_id = _room_id AND status = 'ringing';

  INSERT INTO public.chat_calls (id, room_id, initiated_by, status, ice_config)
    VALUES (_call_id, _room_id, _me, 'ringing', _ice_config);

  INSERT INTO public.chat_call_participants (call_id, user_id, status, joined_at)
    VALUES (_call_id, _me, 'connected', now());

  INSERT INTO public.chat_call_participants (call_id, user_id, status)
    SELECT _call_id, m.user_id, 'ringing'
    FROM public.chat_room_members m
    WHERE m.room_id = _room_id AND m.user_id <> _me AND m.removed_at IS NULL;

  PERFORM public.chat_send_message(
    _room_id, '📞 Call started', 'system',
    jsonb_build_object('call_id', _call_id, 'event', 'call_initiated'),
    NULL, gen_random_uuid()::text
  );

  RETURN _call_id;
END;
$function$;

-- 4. Modify chat_end_call to accept optional _signaling_channel
CREATE OR REPLACE FUNCTION public.chat_end_call(
  _call_id           UUID,
  _end_reason        TEXT DEFAULT 'ended',
  _signaling_channel TEXT DEFAULT 'supabase'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _me UUID := auth.uid(); _room_id UUID; _dur INTEGER;
BEGIN
  SELECT room_id, EXTRACT(EPOCH FROM (now() - connected_at))::INTEGER
    INTO _room_id, _dur
    FROM public.chat_calls WHERE id = _call_id;

  UPDATE public.chat_calls SET
    status = CASE
      WHEN _end_reason = 'declined'  THEN 'declined'::public.chat_call_status
      WHEN _end_reason = 'missed'    THEN 'missed'::public.chat_call_status
      WHEN _end_reason = 'no_answer' THEN 'no_answer'::public.chat_call_status
      WHEN _end_reason = 'failed'    THEN 'failed'::public.chat_call_status
      ELSE 'ended'::public.chat_call_status
    END,
    ended_at = now(),
    duration_seconds = GREATEST(COALESCE(_dur, 0), 0),
    end_reason = _end_reason,
    signaling_channel = _signaling_channel
  WHERE id = _call_id;

  UPDATE public.chat_call_participants
  SET status = 'disconnected', left_at = now()
  WHERE call_id = _call_id AND user_id = _me;

  IF _end_reason NOT IN ('declined', 'missed', 'no_answer') THEN
    PERFORM public.chat_send_message(
      _room_id,
      '📞 Call ended · ' || COALESCE(_dur::text || 's', '0s'),
      'call_summary',
      jsonb_build_object('call_id', _call_id, 'duration_seconds', _dur),
      NULL,
      gen_random_uuid()::text
    );
  END IF;
END;
$function$;

-- 5. Ensure chat_call_participants has REPLICA IDENTITY FULL and is in realtime publication
ALTER TABLE public.chat_call_participants REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'chat_call_participants'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_call_participants;
  END IF;
END $$;
