CREATE OR REPLACE FUNCTION public.chat_get_rooms_v2()
RETURNS TABLE (
  room_id UUID,
  room_type public.chat_room_type,
  name TEXT,
  avatar_url TEXT,
  is_direct BOOLEAN,
  last_message_at TIMESTAMPTZ,
  last_message_preview TEXT,
  unread_count BIGINT,
  is_muted BOOLEAN,
  is_pinned BOOLEAN,
  is_archived BOOLEAN,
  member_count BIGINT,
  other_user_id UUID,
  other_user_metadata JSONB,
  policy JSONB
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    r.id AS room_id,
    r.type AS room_type,
    CASE
      WHEN r.is_direct AND other_mem.user_id IS NOT NULL THEN
        COALESCE(
          NULLIF(mp.display_name, ''),
          NULLIF(mp.nickname, ''),
          NULLIF(p.display_name, ''),
          NULLIF(p.full_name, ''),
          NULLIF(p.username, ''),
          NULLIF(u.raw_user_meta_data ->> 'full_name', ''),
          NULLIF(u.raw_user_meta_data ->> 'name', ''),
          NULLIF(split_part(u.email, '@', 1), ''),
          r.name,
          'Direct Message'
        )
      ELSE r.name
    END AS name,
    CASE
      WHEN r.is_direct THEN COALESCE(mp.avatar_url, p.avatar_url, r.avatar_url)
      ELSE r.avatar_url
    END AS avatar_url,
    r.is_direct AS is_direct,
    r.last_message_at AS last_message_at,
    r.last_message_preview AS last_message_preview,
    CASE
      WHEN mem.last_read_at IS NULL THEN
        (
          SELECT COUNT(*)
          FROM public.chat_messages m
          WHERE m.room_id = r.id
            AND m.sender_id <> auth.uid()
            AND m.is_deleted = FALSE
        )
      ELSE
        (
          SELECT COUNT(*)
          FROM public.chat_messages m
          WHERE m.room_id = r.id
            AND m.sender_id <> auth.uid()
            AND m.is_deleted = FALSE
            AND m.created_at > mem.last_read_at
        )
    END AS unread_count,
    mem.is_muted AS is_muted,
    mem.is_pinned AS is_pinned,
    mem.is_archived AS is_archived,
    (
      SELECT COUNT(*)
      FROM public.chat_room_members m2
      WHERE m2.room_id = r.id
        AND m2.removed_at IS NULL
    ) AS member_count,
    other_mem.user_id AS other_user_id,
    CASE
      WHEN r.is_direct AND other_mem.user_id IS NOT NULL THEN
        jsonb_strip_nulls(
          jsonb_build_object(
            'display_name',
            COALESCE(
              NULLIF(mp.display_name, ''),
              NULLIF(mp.nickname, ''),
              NULLIF(p.display_name, ''),
              NULLIF(p.full_name, ''),
              NULLIF(p.username, ''),
              NULLIF(u.raw_user_meta_data ->> 'full_name', ''),
              NULLIF(u.raw_user_meta_data ->> 'name', ''),
              NULLIF(split_part(u.email, '@', 1), '')
            ),
            'nickname', NULLIF(mp.nickname, ''),
            'avatar_url', COALESCE(mp.avatar_url, p.avatar_url),
            'email', u.email,
            'merchant_id', mp.merchant_id
          )
        )
      ELSE '{}'::jsonb
    END AS other_user_metadata,
    jsonb_build_object(
      'id', pol.id,
      'room_type', pol.room_type,
      'encryption_mode', pol.encryption_mode,
      'retention_hours', pol.retention_hours,
      'allow_files', pol.allow_files,
      'allow_voice_notes', pol.allow_voice_notes,
      'allow_images', pol.allow_images,
      'allow_calls', pol.allow_calls,
      'allow_group_calls', pol.allow_group_calls,
      'moderation_level', pol.moderation_level,
      'history_searchable', pol.history_searchable,
      'watermark_enabled', pol.watermark_enabled,
      'disappearing_default_hours', pol.disappearing_default_hours,
      'max_file_size_mb', pol.max_file_size_mb,
      'allowed_mime_types', pol.allowed_mime_types,
      'screenshot_protection', pol.screenshot_protection,
      'link_preview_enabled', pol.link_preview_enabled,
      'disable_forwarding', COALESCE(pol.disable_forwarding, FALSE),
      'disable_export', COALESCE(pol.disable_export, FALSE),
      'strip_forward_sender_identity', COALESCE(pol.strip_forward_sender_identity, FALSE)
    ) AS policy
  FROM public.chat_rooms r
  JOIN public.chat_room_members mem
    ON mem.room_id = r.id
   AND mem.user_id = auth.uid()
   AND mem.removed_at IS NULL
  LEFT JOIN LATERAL (
    SELECT m2.user_id
    FROM public.chat_room_members m2
    WHERE r.is_direct = TRUE
      AND m2.room_id = r.id
      AND m2.user_id <> auth.uid()
      AND m2.removed_at IS NULL
    LIMIT 1
  ) AS other_mem ON TRUE
  LEFT JOIN auth.users u
    ON u.id = other_mem.user_id
  LEFT JOIN public.merchant_profiles mp
    ON mp.user_id = other_mem.user_id
  LEFT JOIN public.profiles p
    ON p.user_id = other_mem.user_id
  LEFT JOIN public.chat_room_policies pol
    ON pol.id = r.policy_id
  WHERE mem.is_archived = FALSE
  ORDER BY COALESCE(r.last_message_at, r.created_at) DESC, r.id;
$$;
