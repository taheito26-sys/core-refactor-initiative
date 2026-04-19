-- Fix chat_answer_call and chat_end_call to match actual chat_calls schema.
-- Previous migration referenced non-existent columns on chat_calls:
--   - sdp_answer          → lives on chat_call_participants, not chat_calls
--   - signaling_channel   → never added to the schema
--
-- In the current architecture SDP exchange flows through the signaling
-- WebSocket relay, so the RPC does not need to persist SDP at all. We
-- accept the parameter for backward-compat but ignore its value.

DROP FUNCTION IF EXISTS public.chat_answer_call(UUID, TEXT);
DROP FUNCTION IF EXISTS public.chat_end_call(UUID, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.chat_end_call(UUID, TEXT);

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
      connected_at = now()
  WHERE id = _call_id AND status = 'ringing';

  UPDATE public.chat_call_participants
  SET status = 'connected',
      joined_at = COALESCE(joined_at, now()),
      sdp_answer = _sdp_answer
  WHERE call_id = _call_id AND user_id = _me;
END;
$function$;

CREATE OR REPLACE FUNCTION public.chat_end_call(
  _call_id UUID,
  _end_reason TEXT DEFAULT 'ended',
  _signaling_channel TEXT DEFAULT NULL
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
  -- _signaling_channel is accepted for backward-compatibility but not stored
  -- (no column on chat_calls; signaling transport is chosen client-side).
  PERFORM _signaling_channel;

  SELECT room_id, EXTRACT(EPOCH FROM (now() - connected_at))::INTEGER
  INTO _room_id, _dur
  FROM public.chat_calls
  WHERE id = _call_id;

  UPDATE public.chat_calls
  SET status = CASE
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

  IF _end_reason NOT IN ('declined', 'missed', 'no_answer') AND _room_id IS NOT NULL THEN
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

GRANT EXECUTE ON FUNCTION public.chat_answer_call(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.chat_end_call(UUID, TEXT, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
