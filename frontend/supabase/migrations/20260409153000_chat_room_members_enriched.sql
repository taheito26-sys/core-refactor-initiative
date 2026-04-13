CREATE OR REPLACE FUNCTION public.chat_get_room_members(_room_id UUID)
RETURNS TABLE (
  id UUID,
  room_id UUID,
  user_id UUID,
  role public.chat_member_role,
  display_name_override TEXT,
  joined_at TIMESTAMPTZ,
  invited_by UUID,
  is_muted BOOLEAN,
  muted_until TIMESTAMPTZ,
  is_pinned BOOLEAN,
  is_archived BOOLEAN,
  notification_level TEXT,
  last_read_message_id UUID,
  last_read_at TIMESTAMPTZ,
  removed_at TIMESTAMPTZ,
  display_name TEXT,
  avatar_url TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    m.id,
    m.room_id,
    m.user_id,
    m.role,
    m.display_name_override,
    m.joined_at,
    m.invited_by,
    m.is_muted,
    m.muted_until,
    m.is_pinned,
    m.is_archived,
    m.notification_level,
    m.last_read_message_id,
    m.last_read_at,
    m.removed_at,
    COALESCE(
      NULLIF(m.display_name_override, ''),
      NULLIF(mp.display_name, ''),
      NULLIF(mp.nickname, ''),
      NULLIF(cp.display_name, ''),
      NULLIF(p.display_name, ''),
      NULLIF(p.full_name, ''),
      NULLIF(p.username, ''),
      NULLIF(u.raw_user_meta_data ->> 'full_name', ''),
      NULLIF(u.raw_user_meta_data ->> 'name', ''),
      NULLIF(split_part(u.email, '@', 1), ''),
      left(m.user_id::text, 8)
    ) AS display_name,
    COALESCE(mp.avatar_url, p.avatar_url) AS avatar_url
  FROM public.chat_room_members m
  JOIN public.chat_rooms r
    ON r.id = m.room_id
  LEFT JOIN auth.users u
    ON u.id = m.user_id
  LEFT JOIN public.merchant_profiles mp
    ON mp.user_id = m.user_id
  LEFT JOIN public.customer_profiles cp
    ON cp.user_id = m.user_id
  LEFT JOIN public.profiles p
    ON p.user_id = m.user_id
  WHERE m.room_id = _room_id
    AND m.removed_at IS NULL
    AND public.fn_is_chat_member(_room_id, auth.uid())
  ORDER BY m.role DESC, lower(
    COALESCE(
      NULLIF(m.display_name_override, ''),
      NULLIF(mp.display_name, ''),
      NULLIF(mp.nickname, ''),
      NULLIF(cp.display_name, ''),
      NULLIF(p.display_name, ''),
      NULLIF(p.full_name, ''),
      NULLIF(p.username, ''),
      NULLIF(u.raw_user_meta_data ->> 'full_name', ''),
      NULLIF(u.raw_user_meta_data ->> 'name', ''),
      NULLIF(split_part(u.email, '@', 1), ''),
      left(m.user_id::text, 8)
    )
  );
$$;

GRANT EXECUTE ON FUNCTION public.chat_get_room_members(UUID) TO authenticated;
