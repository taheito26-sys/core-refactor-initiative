-- =============================================================================
-- Migration: 20260408130000_fix_chat_get_rooms.sql
-- Purpose  : Fix chat_get_rooms() to return populated other_user_metadata for
--            direct (1-to-1) rooms.
--
-- Bug      : The previous implementation hard-coded '{}'::JSONB for the
--            other_user_metadata column, so clients never received the other
--            participant's display name or avatar.
--
-- Fix      : For is_direct = TRUE rooms we resolve the other_user_id, then
--            LEFT JOIN to merchant_profiles and profiles to build a JSONB
--            object containing at least { "display_name": "...",
--            "avatar_url": "..." }.  The `name` column is also set to the
--            best available display name so clients can use r.name directly.
--            For group / non-direct rooms the behaviour is unchanged.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.chat_get_rooms()
RETURNS TABLE (
  room_id              UUID,
  room_type            public.chat_room_type,
  name                 TEXT,
  avatar_url           TEXT,
  is_direct            BOOLEAN,
  last_message_at      TIMESTAMPTZ,
  last_message_preview TEXT,
  unread_count         BIGINT,
  is_muted             BOOLEAN,
  is_pinned            BOOLEAN,
  is_archived          BOOLEAN,
  member_count         BIGINT,
  other_user_id        UUID,
  other_user_metadata  JSONB
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    r.id                                                  AS room_id,
    r.type                                                AS room_type,

    -- For direct rooms: use the best available name from the other user's
    -- profiles; fall through a priority chain to 'Unknown'.
    -- For group rooms: keep whatever name the room itself carries.
    CASE
      WHEN r.is_direct THEN
        COALESCE(
          mp.display_name,
          mp.nickname,
          p.full_name,
          p.username,
          'Unknown'
        )
      ELSE r.name
    END                                                   AS name,

    -- For direct rooms: prefer the other user's avatar; fall back to the
    -- room-level avatar (if any).
    CASE
      WHEN r.is_direct THEN COALESCE(mp.avatar_url, p.avatar_url, r.avatar_url)
      ELSE r.avatar_url
    END                                                   AS avatar_url,

    r.is_direct                                           AS is_direct,
    r.last_message_at                                     AS last_message_at,
    r.last_message_preview                                AS last_message_preview,

    -- Unread count: messages the current user has not yet read.
    COALESCE((
      SELECT COUNT(*)
      FROM   public.chat_messages m
      WHERE  m.room_id    = r.id
      AND    m.is_deleted = FALSE
      AND    m.sender_id <> auth.uid()
      AND    NOT EXISTS (
        SELECT 1
        FROM   public.chat_message_receipts rcpt
        WHERE  rcpt.message_id = m.id
        AND    rcpt.user_id    = auth.uid()
        AND    rcpt.status     = 'read'
      )
    ), 0)                                                 AS unread_count,

    mem.is_muted                                          AS is_muted,
    mem.is_pinned                                         AS is_pinned,
    mem.is_archived                                       AS is_archived,

    -- Total active members in the room.
    (
      SELECT COUNT(*)
      FROM   public.chat_room_members m2
      WHERE  m2.room_id    = r.id
      AND    m2.removed_at IS NULL
    )                                                     AS member_count,

    -- other_user_id: only meaningful for direct rooms.
    other_mem.user_id                                     AS other_user_id,

    -- other_user_metadata: populated for direct rooms, empty for group rooms.
    CASE
      WHEN r.is_direct AND other_mem.user_id IS NOT NULL THEN
        jsonb_strip_nulls(
          jsonb_build_object(
            'display_name', COALESCE(
                              mp.display_name,
                              mp.nickname,
                              p.full_name,
                              p.username,
                              'Unknown'
                            ),
            'avatar_url',   COALESCE(mp.avatar_url, p.avatar_url)
          )
        )
      ELSE '{}'::JSONB
    END                                                   AS other_user_metadata

  FROM  public.chat_rooms        r
  JOIN  public.chat_room_members mem
        ON  mem.room_id    = r.id
        AND mem.user_id    = auth.uid()
        AND mem.removed_at IS NULL

  -- Resolve the other participant for direct rooms (NULL for group rooms).
  LEFT JOIN LATERAL (
    SELECT m2.user_id
    FROM   public.chat_room_members m2
    WHERE  m2.room_id    = r.id
    AND    m2.user_id   <> auth.uid()
    AND    m2.removed_at IS NULL
    LIMIT  1
  ) other_mem ON r.is_direct = TRUE

  -- Look up the other user's merchant profile (may not exist).
  LEFT JOIN public.merchant_profiles mp
        ON  mp.user_id = other_mem.user_id

  -- Look up the other user's base profile (may not exist).
  LEFT JOIN public.profiles p
        ON  p.user_id  = other_mem.user_id

  WHERE mem.is_archived = FALSE

  ORDER BY COALESCE(r.last_message_at, r.created_at) DESC;
$$;
