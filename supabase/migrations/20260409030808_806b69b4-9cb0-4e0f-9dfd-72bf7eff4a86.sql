
-- 1. Create the missing chat_push_ice_candidate RPC
CREATE OR REPLACE FUNCTION public.chat_push_ice_candidate(
  _call_id UUID,
  _candidate JSONB
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _me UUID := auth.uid();
BEGIN
  UPDATE public.chat_call_participants
  SET ice_candidates = ice_candidates || jsonb_build_array(_candidate)
  WHERE call_id = _call_id
    AND user_id != _me;  -- push to the OTHER participant(s)
END;
$$;

-- 2. Fix chat_end_call to properly map no_answer and failed statuses
CREATE OR REPLACE FUNCTION public.chat_end_call(
  _call_id UUID,
  _end_reason TEXT DEFAULT 'ended'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
    end_reason = _end_reason
  WHERE id = _call_id;

  UPDATE public.chat_call_participants
  SET status = 'disconnected', left_at = now()
  WHERE call_id = _call_id AND user_id = _me;

  -- Only send call summary for completed calls (not missed/declined which are handled differently)
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
$$;
