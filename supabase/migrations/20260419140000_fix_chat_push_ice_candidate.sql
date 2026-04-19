-- Fix chat_push_ice_candidate to match the CDC subscription pattern.
--
-- The previous override (migration 20260409030808 and inherited by my
-- 20260419120000) wrote ICE candidates to the OTHER participant's row
-- (WHERE user_id != _me). But the Supabase Realtime subscription in
-- src/features/chat/lib/signaling/supabase-channel.ts processes ICE
-- only when row.user_id !== userId — i.e. the remote peer's own row.
--
-- Result: candidates landed on the receiver's OWN row, the receiver's
-- subscription filter skipped them (own-row events), and ICE never
-- paired. Calls got stuck in "connecting" until the ICE agent timed
-- out and failed.
--
-- The canonical pattern (matches publishOffer/publishAnswer):
--   each peer writes SDP + ICE to their OWN participant row; the other
--   peer's CDC subscription picks it up because row.user_id !== them.

DROP FUNCTION IF EXISTS public.chat_push_ice_candidate(UUID, JSONB);

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
  SET ice_candidates = COALESCE(ice_candidates, '[]'::jsonb)
                       || jsonb_build_array(_candidate)
  WHERE call_id = _call_id AND user_id = _me;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.chat_push_ice_candidate(UUID, JSONB) TO authenticated;

NOTIFY pgrst, 'reload schema';
