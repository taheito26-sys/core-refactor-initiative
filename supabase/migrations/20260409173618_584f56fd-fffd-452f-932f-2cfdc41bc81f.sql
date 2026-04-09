-- Enable watermark by default for the Qatar P2P Market room policy
UPDATE public.chat_room_policies
SET watermark_enabled = true,
    screenshot_protection = true
WHERE id = '971628d9-6d14-4004-887f-503464d53064';

-- Allow room owners/admins to update their room's policy
CREATE OR REPLACE FUNCTION public.chat_update_room_policy(
  _room_id uuid,
  _updates jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _me uuid := auth.uid();
  _policy_id uuid;
  _my_role text;
  _result jsonb;
BEGIN
  IF _me IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Check caller is owner or admin of the room
  SELECT role INTO _my_role
  FROM public.chat_room_members
  WHERE room_id = _room_id AND user_id = _me AND removed_at IS NULL;

  IF _my_role IS NULL OR _my_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Only room owner or admin can update policies';
  END IF;

  -- Get policy_id
  SELECT policy_id INTO _policy_id
  FROM public.chat_rooms
  WHERE id = _room_id;

  IF _policy_id IS NULL THEN
    RAISE EXCEPTION 'Room has no policy';
  END IF;

  -- Apply updates (only allowed fields)
  UPDATE public.chat_room_policies SET
    watermark_enabled = COALESCE((_updates->>'watermark_enabled')::boolean, watermark_enabled),
    screenshot_protection = COALESCE((_updates->>'screenshot_protection')::boolean, screenshot_protection),
    disable_forwarding = COALESCE((_updates->>'disable_forwarding')::boolean, disable_forwarding),
    disable_export = COALESCE((_updates->>'disable_export')::boolean, disable_export),
    history_searchable = COALESCE((_updates->>'history_searchable')::boolean, history_searchable),
    allow_calls = COALESCE((_updates->>'allow_calls')::boolean, allow_calls),
    allow_files = COALESCE((_updates->>'allow_files')::boolean, allow_files),
    allow_images = COALESCE((_updates->>'allow_images')::boolean, allow_images),
    allow_voice_notes = COALESCE((_updates->>'allow_voice_notes')::boolean, allow_voice_notes),
    strip_forward_sender_identity = COALESCE((_updates->>'strip_forward_sender_identity')::boolean, strip_forward_sender_identity),
    link_preview_enabled = COALESCE((_updates->>'link_preview_enabled')::boolean, link_preview_enabled),
    updated_at = now()
  WHERE id = _policy_id;

  -- Return updated policy
  SELECT to_jsonb(p) INTO _result
  FROM public.chat_room_policies p
  WHERE p.id = _policy_id;

  RETURN _result;
END;
$$;

REVOKE ALL ON FUNCTION public.chat_update_room_policy(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.chat_update_room_policy(uuid, jsonb) TO authenticated;