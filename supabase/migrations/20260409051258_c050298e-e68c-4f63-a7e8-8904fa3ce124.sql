
-- Fix the RPC to always find the singleton collab room first
CREATE OR REPLACE FUNCTION public.chat_get_or_create_collab_room(_name text DEFAULT 'Qatar P2P Market')
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _me UUID := auth.uid();
  _room_id UUID;
  _policy UUID;
  _super_admin UUID := 'c0c85f54-ad64-4baf-9247-6c81d131d9d9';
BEGIN
  -- Always look for THE existing collab room first (singleton)
  SELECT r.id INTO _room_id
  FROM public.chat_rooms r
  WHERE r.type = 'merchant_collab'
  ORDER BY r.created_at ASC
  LIMIT 1;

  IF _room_id IS NOT NULL THEN
    -- Auto-join the caller if not already a member
    INSERT INTO public.chat_room_members (room_id, user_id, role)
    VALUES (
      _room_id,
      _me,
      CASE WHEN _me = _super_admin THEN 'owner'::chat_member_role ELSE 'member'::chat_member_role END
    )
    ON CONFLICT (room_id, user_id)
    DO UPDATE SET removed_at = NULL,
      role = CASE WHEN _me = _super_admin THEN 'owner'::chat_member_role ELSE chat_room_members.role END;
    RETURN _room_id;
  END IF;

  -- No collab room exists yet — create one
  SELECT id INTO _policy FROM public.chat_room_policies WHERE room_type = 'merchant_collab';

  INSERT INTO public.chat_rooms (type, name, created_by, policy_id, is_direct)
  VALUES ('merchant_collab', _name, _me, _policy, FALSE)
  RETURNING id INTO _room_id;

  INSERT INTO public.chat_room_members (room_id, user_id, role)
  VALUES (_room_id, _me, CASE WHEN _me = _super_admin THEN 'owner'::chat_member_role ELSE 'member'::chat_member_role END);

  RETURN _room_id;
END;
$$;
