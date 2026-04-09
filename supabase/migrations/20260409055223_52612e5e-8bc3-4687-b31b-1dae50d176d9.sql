
DROP FUNCTION IF EXISTS public.chat_get_rooms_v2();

CREATE OR REPLACE FUNCTION public.chat_get_rooms_v2()
RETURNS TABLE(
  room_id uuid,
  room_name text,
  room_type text,
  is_direct boolean,
  last_message_at timestamptz,
  last_message_preview text,
  unread_count bigint,
  my_role text,
  is_muted boolean,
  is_pinned boolean,
  is_archived boolean,
  room_policy jsonb,
  room_avatar text,
  other_user_metadata jsonb
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE _me UUID := auth.uid();
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  RETURN QUERY
    SELECT
      r.id AS room_id,
      -- Resolve DM room name from counterparty profile
      CASE
        WHEN r.is_direct THEN COALESCE(
          mp_other.display_name,
          mp_other.nickname,
          pr_other.full_name,
          pr_other.username,
          (au_other.raw_user_meta_data->>'full_name'),
          (au_other.raw_user_meta_data->>'name'),
          split_part(COALESCE(pr_other.email, au_other.email), '@', 1),
          r.name,
          'Direct Message'
        )
        ELSE COALESCE(r.name, 'Unnamed Room')
      END AS room_name,
      r.type::text AS room_type,
      r.is_direct,
      r.last_message_at,
      r.last_message_preview,
      COALESCE((
        SELECT count(*) FROM public.chat_messages m
        WHERE m.room_id = r.id AND m.is_deleted = false
          AND m.created_at > COALESCE(mem.last_read_at, mem.joined_at)
          AND m.sender_id <> _me
      ), 0)::bigint AS unread_count,
      mem.role::text AS my_role,
      mem.is_muted,
      mem.is_pinned,
      mem.is_archived,
      -- Policy JSON
      CASE WHEN p.id IS NOT NULL THEN jsonb_build_object(
        'encryption_mode', p.encryption_mode::text,
        'allow_calls', p.allow_calls,
        'allow_files', p.allow_files,
        'allow_images', p.allow_images,
        'allow_voice_notes', p.allow_voice_notes,
        'screenshot_protection', p.screenshot_protection,
        'watermark_enabled', p.watermark_enabled,
        'disable_forwarding', p.disable_forwarding,
        'disable_export', p.disable_export,
        'strip_forward_sender_identity', p.strip_forward_sender_identity,
        'retention_hours', p.retention_hours,
        'max_file_size_mb', p.max_file_size_mb
      ) ELSE NULL END AS room_policy,
      -- Avatar: prefer counterparty merchant avatar, then profile, then room
      CASE
        WHEN r.is_direct THEN COALESCE(mp_other.avatar_url, pr_other.avatar_url, r.avatar_url)
        ELSE r.avatar_url
      END AS room_avatar,
      -- Other user metadata for DMs
      CASE
        WHEN r.is_direct AND other_mem.user_id IS NOT NULL THEN jsonb_build_object(
          'display_name', COALESCE(mp_other.display_name, pr_other.full_name, pr_other.username),
          'nickname', mp_other.nickname,
          'avatar_url', COALESCE(mp_other.avatar_url, pr_other.avatar_url),
          'email', COALESCE(pr_other.email, au_other.email),
          'merchant_id', mp_other.merchant_id
        )
        ELSE NULL
      END AS other_user_metadata
    FROM public.chat_rooms r
    JOIN public.chat_room_members mem
      ON mem.room_id = r.id AND mem.user_id = _me AND mem.removed_at IS NULL
    LEFT JOIN public.chat_room_policies p ON p.id = r.policy_id
    -- For DMs: find the other member
    LEFT JOIN LATERAL (
      SELECT om.user_id
      FROM public.chat_room_members om
      WHERE om.room_id = r.id AND om.user_id <> _me AND om.removed_at IS NULL
      LIMIT 1
    ) other_mem ON r.is_direct
    LEFT JOIN public.merchant_profiles mp_other ON mp_other.user_id = other_mem.user_id
    LEFT JOIN public.profiles pr_other ON pr_other.user_id = other_mem.user_id
    LEFT JOIN auth.users au_other ON au_other.id = other_mem.user_id
    ORDER BY COALESCE(r.last_message_at, r.created_at) DESC;
END;
$$;
