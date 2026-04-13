
CREATE OR REPLACE FUNCTION public.chat_get_room_members(_room_id uuid)
RETURNS TABLE (
  id            uuid,
  room_id       uuid,
  user_id       uuid,
  role          public.chat_member_role,
  joined_at     timestamptz,
  last_read_at  timestamptz,
  last_read_message_id uuid,
  is_muted      boolean,
  is_pinned     boolean,
  is_archived   boolean,
  notification_level text,
  display_name  text,
  avatar_url    text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    m.id,
    m.room_id,
    m.user_id,
    m.role,
    m.joined_at,
    m.last_read_at,
    m.last_read_message_id,
    m.is_muted,
    m.is_pinned,
    m.is_archived,
    m.notification_level,
    COALESCE(
      NULLIF(TRIM(m.display_name_override), ''),
      NULLIF(TRIM(mp.display_name), ''),
      NULLIF(TRIM(mp.nickname), ''),
      NULLIF(TRIM(cp.display_name), ''),
      NULLIF(TRIM(pr.full_name), ''),
      NULLIF(TRIM(pr.username), ''),
      NULLIF(TRIM(au.raw_user_meta_data->>'full_name'), ''),
      NULLIF(TRIM(au.raw_user_meta_data->>'name'), ''),
      NULLIF(SPLIT_PART(COALESCE(pr.email, au.email), '@', 1), ''),
      LEFT(m.user_id::text, 8)
    ) AS display_name,
    COALESCE(
      NULLIF(TRIM(mp.avatar_url), ''),
      NULLIF(TRIM(pr.avatar_url), '')
    ) AS avatar_url
  FROM public.chat_room_members m
  LEFT JOIN public.merchant_profiles mp ON mp.user_id = m.user_id
  LEFT JOIN public.customer_profiles cp ON cp.user_id = m.user_id
  LEFT JOIN public.profiles           pr ON pr.user_id = m.user_id
  LEFT JOIN auth.users                au ON au.id      = m.user_id
  WHERE m.room_id = _room_id
    AND m.removed_at IS NULL
    AND fn_is_chat_member(_room_id, auth.uid());
$$;
