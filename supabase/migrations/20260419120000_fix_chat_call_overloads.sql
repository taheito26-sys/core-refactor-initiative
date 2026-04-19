-- CRITICAL: Remove ALL duplicate call function signatures
-- Voice and video calls were failing due to function overloading ambiguity.

-- ══════════════════════════════════════════════════════════════════════════
-- Drop all versions of chat_initiate_call
-- ══════════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.chat_initiate_call(UUID);
DROP FUNCTION IF EXISTS public.chat_initiate_call(UUID, UUID);
DROP FUNCTION IF EXISTS public.chat_initiate_call(UUID, UUID, JSONB);

-- ══════════════════════════════════════════════════════════════════════════
-- Drop all versions of chat_end_call
-- ══════════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.chat_end_call(UUID);
DROP FUNCTION IF EXISTS public.chat_end_call(UUID, TEXT);
DROP FUNCTION IF EXISTS public.chat_end_call(UUID, TEXT, TEXT);

-- ══════════════════════════════════════════════════════════════════════════
-- Drop all versions of chat_answer_call
-- ══════════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.chat_answer_call(UUID, TEXT);

-- ══════════════════════════════════════════════════════════════════════════
-- Drop all versions of chat_push_ice_candidate
-- ══════════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.chat_push_ice_candidate(UUID, JSONB);

-- ══════════════════════════════════════════════════════════════════════════
-- Recreate chat_initiate_call (canonical version)
-- ══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.chat_initiate_call(
  _room_id UUID,
  _call_id UUID DEFAULT NULL,
  _ice_config JSONB DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _me UUID := auth.uid();
  _policy RECORD;
BEGIN
  IF _call_id IS NULL THEN
    _call_id := gen_random_uuid();
  END IF;

  SELECT p.allow_calls
  INTO _policy
  FROM public.chat_rooms r
  JOIN public.chat_room_policies p ON p.id = r.policy_id
  WHERE r.id = _room_id;

  IF NOT _policy.allow_calls THEN
    RAISE EXCEPTION 'Calls not permitted';
  END IF;

  IF NOT public.fn_is_chat_member(_room_id, _me) THEN
    RAISE EXCEPTION 'Not a member';
  END IF;

  UPDATE public.chat_calls
  SET status = 'missed', ended_at = now()
  WHERE room_id = _room_id AND status = 'ringing';

  INSERT INTO public.chat_calls (id, room_id, initiated_by, status, ice_config)
  VALUES (_call_id, _room_id, _me, 'ringing', _ice_config);

  INSERT INTO public.chat_call_participants (call_id, user_id, status, joined_at)
  VALUES (_call_id, _me, 'connected', now());

  INSERT INTO public.chat_call_participants (call_id, user_id, status)
  SELECT _call_id, m.user_id, 'ringing'
  FROM public.chat_room_members m
  WHERE m.room_id = _room_id
    AND m.user_id <> _me
    AND m.removed_at IS NULL;

  PERFORM public.chat_send_message(
    _room_id,
    'Call started',
    'system'::public.chat_message_type,
    jsonb_build_object('call_id', _call_id, 'event', 'call_initiated'),
    NULL,
    gen_random_uuid()::text
  );

  RETURN _call_id;
END;
$function$;

-- ══════════════════════════════════════════════════════════════════════════
-- Recreate chat_end_call (canonical version with optional signaling_channel)
-- ══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.chat_end_call(
  _call_id UUID,
  _end_reason TEXT DEFAULT 'ended',
  _signaling_channel TEXT DEFAULT 'supabase'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _me UUID := auth.uid();
  _room_id UUID;
  _dur INTEGER;
BEGIN
  SELECT room_id, EXTRACT(EPOCH FROM (now() - connected_at))::INTEGER
  INTO _room_id, _dur
  FROM public.chat_calls
  WHERE id = _call_id;

  UPDATE public.chat_calls
  SET status = CASE
      WHEN _end_reason = 'declined' THEN 'declined'::public.chat_call_status
      WHEN _end_reason = 'missed' THEN 'missed'::public.chat_call_status
      WHEN _end_reason = 'no_answer' THEN 'no_answer'::public.chat_call_status
      WHEN _end_reason = 'failed' THEN 'failed'::public.chat_call_status
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
      'Call ended · ' || COALESCE(_dur::text || 's', '0s'),
      'call_summary'::public.chat_message_type,
      jsonb_build_object('call_id', _call_id, 'duration_seconds', _dur),
      NULL,
      gen_random_uuid()::text
    );
  END IF;
END;
$function$;

-- ══════════════════════════════════════════════════════════════════════════
-- Recreate chat_answer_call (canonical version)
-- ══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.chat_answer_call(
  _call_id UUID,
  _sdp_answer TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _me UUID := auth.uid();
BEGIN
  UPDATE public.chat_calls
  SET status = 'active'::public.chat_call_status,
      connected_at = now(),
      sdp_answer = _sdp_answer
  WHERE id = _call_id AND status = 'ringing';

  UPDATE public.chat_call_participants
  SET status = 'connected', joined_at = now()
  WHERE call_id = _call_id AND user_id = _me;
END;
$function$;

-- ══════════════════════════════════════════════════════════════════════════
-- Recreate chat_push_ice_candidate (canonical version)
-- ══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.chat_push_ice_candidate(
  _call_id UUID,
  _candidate JSONB
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _me UUID := auth.uid();
BEGIN
  UPDATE public.chat_call_participants
  SET ice_candidates = COALESCE(ice_candidates, '[]'::jsonb) || jsonb_build_array(_candidate)
  WHERE call_id = _call_id
    AND user_id != _me;
END;
$function$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION public.chat_initiate_call(UUID, UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.chat_end_call(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.chat_answer_call(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.chat_push_ice_candidate(UUID, JSONB) TO authenticated;

-- Force PostgREST to reload the schema
NOTIFY pgrst, 'reload schema';
