
CREATE OR REPLACE FUNCTION public.chat_get_rooms()
RETURNS TABLE (
  room_id UUID, room_type public.chat_room_type, name TEXT, avatar_url TEXT,
  is_direct BOOLEAN, last_message_at TIMESTAMPTZ, last_message_preview TEXT,
  unread_count BIGINT, is_muted BOOLEAN, is_pinned BOOLEAN, is_archived BOOLEAN,
  member_count BIGINT, other_user_id UUID, other_user_metadata JSONB
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    r.id AS room_id, r.type AS room_type,
    CASE WHEN r.is_direct THEN COALESCE(mp.display_name, mp.nickname, p.full_name, p.username, 'Unknown') ELSE r.name END AS name,
    CASE WHEN r.is_direct THEN COALESCE(mp.avatar_url, p.avatar_url, r.avatar_url) ELSE r.avatar_url END AS avatar_url,
    r.is_direct, r.last_message_at, r.last_message_preview,
    COALESCE((
      SELECT COUNT(*) FROM public.chat_messages m
      WHERE m.room_id = r.id AND m.is_deleted = FALSE AND m.sender_id <> auth.uid()
      AND NOT EXISTS (SELECT 1 FROM public.chat_message_receipts rcpt WHERE rcpt.message_id = m.id AND rcpt.user_id = auth.uid() AND rcpt.status = 'read')
    ), 0) AS unread_count,
    mem.is_muted, mem.is_pinned, mem.is_archived,
    (SELECT COUNT(*) FROM public.chat_room_members m2 WHERE m2.room_id = r.id AND m2.removed_at IS NULL) AS member_count,
    other_mem.user_id AS other_user_id,
    CASE WHEN r.is_direct AND other_mem.user_id IS NOT NULL THEN
      jsonb_strip_nulls(jsonb_build_object(
        'display_name', COALESCE(mp.display_name, mp.nickname, p.full_name, p.username, 'Unknown'),
        'avatar_url', COALESCE(mp.avatar_url, p.avatar_url)
      ))
    ELSE '{}'::JSONB END AS other_user_metadata
  FROM public.chat_rooms r
  JOIN public.chat_room_members mem ON mem.room_id = r.id AND mem.user_id = auth.uid() AND mem.removed_at IS NULL
  LEFT JOIN LATERAL (
    SELECT m2.user_id FROM public.chat_room_members m2
    WHERE m2.room_id = r.id AND m2.user_id <> auth.uid() AND m2.removed_at IS NULL LIMIT 1
  ) other_mem ON r.is_direct = TRUE
  LEFT JOIN public.merchant_profiles mp ON mp.user_id = other_mem.user_id
  LEFT JOIN public.profiles p ON p.user_id = other_mem.user_id
  WHERE mem.is_archived = FALSE
  ORDER BY COALESCE(r.last_message_at, r.created_at) DESC;
$$;
