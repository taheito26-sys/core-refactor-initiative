-- ═══════════════════════════════════════════════════════════════════════════
-- UNIFIED CHAT PLATFORM  ·  All phases
-- ═══════════════════════════════════════════════════════════════════════════
-- Phase 1 : Unified schema · data migration · core messaging
-- Phase 2 : Attachments · voice notes · watermark · disappearing / one-time-view
-- Phase 3 : E2EE architecture (key tables; activation in separate migration)
-- Phase 4 : Resilient WebRTC calls (signaling tables)
-- Phase 5 : merchant_collab moderation & searchable history
-- ═══════════════════════════════════════════════════════════════════════════

-- ──────────────────────────────────────────────────────────────
-- 0. Extensions + helpers
-- ──────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";  -- full-text search on messages

-- ──────────────────────────────────────────────────────────────
-- 1. Enum types
-- ──────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE public.chat_room_type AS ENUM ('merchant_private', 'merchant_client', 'merchant_collab');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.chat_member_role AS ENUM ('owner', 'admin', 'member', 'guest');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.chat_message_type AS ENUM (
    'text', 'voice_note', 'image', 'file', 'system',
    'call_summary', 'order_card', 'payment_card', 'reaction_burst'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.chat_call_status AS ENUM (
    'ringing', 'active', 'ended', 'missed', 'declined', 'failed', 'no_answer'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.chat_encryption_mode AS ENUM ('none', 'tls_only', 'server_e2ee', 'client_e2ee');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ──────────────────────────────────────────────────────────────
-- 2. chat_room_policies  (one row per room_type, seeded below)
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.chat_room_policies (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_type                   public.chat_room_type NOT NULL UNIQUE,
  encryption_mode             public.chat_encryption_mode NOT NULL DEFAULT 'tls_only',
  retention_hours             INTEGER,                     -- NULL = indefinite
  allow_files                 BOOLEAN NOT NULL DEFAULT TRUE,
  allow_voice_notes           BOOLEAN NOT NULL DEFAULT TRUE,
  allow_images                BOOLEAN NOT NULL DEFAULT TRUE,
  allow_calls                 BOOLEAN NOT NULL DEFAULT FALSE,
  allow_group_calls           BOOLEAN NOT NULL DEFAULT FALSE,
  moderation_level            TEXT NOT NULL DEFAULT 'none' CHECK (moderation_level IN ('none','light','strict')),
  history_searchable          BOOLEAN NOT NULL DEFAULT FALSE,
  watermark_enabled           BOOLEAN NOT NULL DEFAULT FALSE,
  disappearing_default_hours  INTEGER,                     -- NULL = off
  max_file_size_mb            INTEGER NOT NULL DEFAULT 50,
  allowed_mime_types          TEXT[]  DEFAULT NULL,        -- NULL = all
  screenshot_protection       BOOLEAN NOT NULL DEFAULT FALSE,
  link_preview_enabled        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed default policies per room type
INSERT INTO public.chat_room_policies
  (room_type, encryption_mode, retention_hours, allow_calls, moderation_level,
   history_searchable, watermark_enabled, screenshot_protection, max_file_size_mb)
VALUES
  ('merchant_private', 'client_e2ee', NULL,   TRUE,  'none',   FALSE, TRUE,  TRUE,  100),
  ('merchant_client',  'server_e2ee', NULL,   FALSE, 'light',  FALSE, TRUE,  FALSE, 50),
  ('merchant_collab',  'tls_only',    NULL,   FALSE, 'strict', TRUE,  FALSE, FALSE, 25)
ON CONFLICT (room_type) DO NOTHING;

-- ──────────────────────────────────────────────────────────────
-- 3. chat_rooms
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.chat_rooms (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type                  public.chat_room_type NOT NULL,
  name                  TEXT,
  description           TEXT,
  avatar_url            TEXT,
  created_by            UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  policy_id             UUID REFERENCES public.chat_room_policies(id),
  last_message_id       UUID,
  last_message_at       TIMESTAMPTZ,
  last_message_preview  TEXT,
  is_direct             BOOLEAN NOT NULL DEFAULT FALSE,
  -- collab-specific
  is_announcement_only  BOOLEAN NOT NULL DEFAULT FALSE,
  -- metadata / extensibility
  metadata              JSONB NOT NULL DEFAULT '{}',
  migrated_from         TEXT,            -- 'os_rooms' | 'customer_chat'
  migrated_source_id    UUID,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Populate policy_id from the seeded policies
UPDATE public.chat_rooms cr
SET    policy_id = (
         SELECT id FROM public.chat_room_policies WHERE room_type = cr.type
       )
WHERE  policy_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_chat_rooms_type           ON public.chat_rooms(type);
CREATE INDEX IF NOT EXISTS idx_chat_rooms_last_message   ON public.chat_rooms(last_message_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_chat_rooms_created_by     ON public.chat_rooms(created_by);
CREATE INDEX IF NOT EXISTS idx_chat_rooms_migrated       ON public.chat_rooms(migrated_source_id) WHERE migrated_source_id IS NOT NULL;

-- ──────────────────────────────────────────────────────────────
-- 4. chat_direct_rooms  (prevents duplicate bilateral rooms)
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.chat_direct_rooms (
  user_a_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_b_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  room_id      UUID NOT NULL REFERENCES public.chat_rooms(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY  (user_a_id, user_b_id),
  UNIQUE       (room_id),
  CHECK        (user_a_id < user_b_id)         -- canonical ordering
);

CREATE INDEX IF NOT EXISTS idx_chat_direct_room_id ON public.chat_direct_rooms(room_id);

-- ──────────────────────────────────────────────────────────────
-- 5. chat_room_members
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.chat_room_members (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id               UUID NOT NULL REFERENCES public.chat_rooms(id) ON DELETE CASCADE,
  user_id               UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role                  public.chat_member_role NOT NULL DEFAULT 'member',
  display_name_override TEXT,
  joined_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  invited_by            UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  -- per-member preferences
  is_muted              BOOLEAN NOT NULL DEFAULT FALSE,
  muted_until           TIMESTAMPTZ,
  is_pinned             BOOLEAN NOT NULL DEFAULT FALSE,
  is_archived           BOOLEAN NOT NULL DEFAULT FALSE,
  notification_level    TEXT NOT NULL DEFAULT 'all' CHECK (notification_level IN ('all','mentions','none')),
  -- read state
  last_read_message_id  UUID,
  last_read_at          TIMESTAMPTZ,
  -- soft delete
  removed_at            TIMESTAMPTZ,
  removed_by            UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE (room_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_members_room   ON public.chat_room_members(room_id);
CREATE INDEX IF NOT EXISTS idx_chat_members_user   ON public.chat_room_members(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_members_active ON public.chat_room_members(room_id, user_id) WHERE removed_at IS NULL;

-- ──────────────────────────────────────────────────────────────
-- 6. chat_messages
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.chat_messages (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id             UUID NOT NULL REFERENCES public.chat_rooms(id) ON DELETE CASCADE,
  sender_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  type                public.chat_message_type NOT NULL DEFAULT 'text',
  -- content
  content             TEXT NOT NULL DEFAULT '',
  metadata            JSONB NOT NULL DEFAULT '{}',    -- rich body, reply context, etc.
  -- threading
  reply_to_id         UUID REFERENCES public.chat_messages(id) ON DELETE SET NULL,
  forwarded_from_id   UUID REFERENCES public.chat_messages(id) ON DELETE SET NULL,
  -- idempotency (client generates UUID v4 nonce)
  client_nonce        TEXT UNIQUE,
  -- lifecycle
  is_edited           BOOLEAN NOT NULL DEFAULT FALSE,
  edited_at           TIMESTAMPTZ,
  is_deleted          BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_at          TIMESTAMPTZ,
  deleted_by          UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  deleted_for_sender  BOOLEAN NOT NULL DEFAULT FALSE,
  -- disappearing / one-time-view
  expires_at          TIMESTAMPTZ,
  view_once           BOOLEAN NOT NULL DEFAULT FALSE,
  viewed_by           UUID[] NOT NULL DEFAULT '{}',   -- users who viewed one-time content
  -- privacy
  watermark_text      TEXT,                           -- injected on delivery
  -- search
  search_vector       TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', coalesce(content,''))) STORED,
  -- timestamps
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.chat_rooms ADD COLUMN IF NOT EXISTS last_message_id UUID REFERENCES public.chat_messages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_chat_messages_room        ON public.chat_messages(room_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_messages_sender      ON public.chat_messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_reply       ON public.chat_messages(reply_to_id) WHERE reply_to_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_chat_messages_expires     ON public.chat_messages(expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_chat_messages_search      ON public.chat_messages USING GIN(search_vector);
CREATE INDEX IF NOT EXISTS idx_chat_messages_nonce       ON public.chat_messages(client_nonce) WHERE client_nonce IS NOT NULL;

-- ──────────────────────────────────────────────────────────────
-- 7. chat_message_receipts
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.chat_message_receipts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id  UUID NOT NULL REFERENCES public.chat_messages(id) ON DELETE CASCADE,
  room_id     UUID NOT NULL REFERENCES public.chat_rooms(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status      TEXT NOT NULL DEFAULT 'delivered' CHECK (status IN ('sent','delivered','read')),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (message_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_receipts_message ON public.chat_message_receipts(message_id);
CREATE INDEX IF NOT EXISTS idx_receipts_room    ON public.chat_message_receipts(room_id, user_id);

-- ──────────────────────────────────────────────────────────────
-- 8. chat_message_reactions
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.chat_message_reactions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id  UUID NOT NULL REFERENCES public.chat_messages(id) ON DELETE CASCADE,
  room_id     UUID NOT NULL REFERENCES public.chat_rooms(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  emoji       TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (message_id, user_id, emoji)
);

CREATE INDEX IF NOT EXISTS idx_reactions_message ON public.chat_message_reactions(message_id);

-- ──────────────────────────────────────────────────────────────
-- 9. chat_attachments
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.chat_attachments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id       UUID REFERENCES public.chat_messages(id) ON DELETE CASCADE,
  room_id          UUID NOT NULL REFERENCES public.chat_rooms(id) ON DELETE CASCADE,
  uploader_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  -- storage
  storage_path     TEXT NOT NULL,
  cdn_url          TEXT,
  file_name        TEXT NOT NULL,
  file_size        BIGINT NOT NULL,
  mime_type        TEXT NOT NULL,
  -- media metadata
  thumbnail_path   TEXT,
  duration_ms      INTEGER,    -- voice notes / video
  width            INTEGER,    -- images / video
  height           INTEGER,
  waveform         JSONB,      -- voice note waveform data (array of amplitude floats)
  -- security
  checksum_sha256  TEXT,
  is_validated     BOOLEAN NOT NULL DEFAULT FALSE,
  -- E2EE (Phase 3)
  is_encrypted     BOOLEAN NOT NULL DEFAULT FALSE,
  iv               TEXT,       -- AES-GCM IV (base64)
  auth_tag         TEXT,       -- AES-GCM auth tag (base64)
  -- one-time-view handled via parent message.view_once
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_attachments_message ON public.chat_attachments(message_id);
CREATE INDEX IF NOT EXISTS idx_attachments_room    ON public.chat_attachments(room_id);
CREATE INDEX IF NOT EXISTS idx_attachments_uploader ON public.chat_attachments(uploader_id);

-- ──────────────────────────────────────────────────────────────
-- 10. chat_calls  (Phase 4 — signaling tables created now)
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.chat_calls (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id          UUID NOT NULL REFERENCES public.chat_rooms(id) ON DELETE CASCADE,
  initiated_by     UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  status           public.chat_call_status NOT NULL DEFAULT 'ringing',
  -- timing
  started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  connected_at     TIMESTAMPTZ,
  ended_at         TIMESTAMPTZ,
  duration_seconds INTEGER,
  -- diagnostics
  end_reason       TEXT,
  ice_config       JSONB,      -- STUN/TURN server config used
  quality_stats    JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.chat_call_participants (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id      UUID NOT NULL REFERENCES public.chat_calls(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'ringing' CHECK (status IN ('ringing','connected','disconnected','declined')),
  joined_at    TIMESTAMPTZ,
  left_at      TIMESTAMPTZ,
  sdp_offer    TEXT,           -- WebRTC SDP offer (initiator → recipient)
  sdp_answer   TEXT,           -- WebRTC SDP answer (recipient → initiator)
  ice_candidates JSONB NOT NULL DEFAULT '[]',
  UNIQUE (call_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_calls_room   ON public.chat_calls(room_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_calls_status ON public.chat_calls(status) WHERE status IN ('ringing','active');
CREATE INDEX IF NOT EXISTS idx_call_participants ON public.chat_call_participants(call_id);
CREATE INDEX IF NOT EXISTS idx_call_participant_user ON public.chat_call_participants(user_id, status);

-- ──────────────────────────────────────────────────────────────
-- 11. chat_presence
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.chat_presence (
  user_id      UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'offline' CHECK (status IN ('online','away','offline')),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  device_info  JSONB NOT NULL DEFAULT '{}',
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ──────────────────────────────────────────────────────────────
-- 12. chat_typing_state
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.chat_typing_state (
  room_id    UUID NOT NULL REFERENCES public.chat_rooms(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  is_typing  BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '8 seconds'),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_typing_room    ON public.chat_typing_state(room_id) WHERE is_typing = TRUE;
CREATE INDEX IF NOT EXISTS idx_typing_expires ON public.chat_typing_state(expires_at);

-- ──────────────────────────────────────────────────────────────
-- 13. chat_device_keys  (Phase 3 E2EE)
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.chat_device_keys (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_id    TEXT NOT NULL,
  key_type     TEXT NOT NULL DEFAULT 'identity' CHECK (key_type IN ('identity','signed_prekey','one_time_prekey')),
  public_key   TEXT NOT NULL,       -- base64-encoded public key
  key_id       INTEGER,             -- for pre-keys
  signature    TEXT,                -- for signed pre-keys
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  used_at      TIMESTAMPTZ,
  UNIQUE (user_id, device_id, key_type)
);

CREATE INDEX IF NOT EXISTS idx_device_keys_user ON public.chat_device_keys(user_id, key_type) WHERE is_active = TRUE;

-- ──────────────────────────────────────────────────────────────
-- 14. chat_e2ee_sessions  (Phase 3 E2EE)
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.chat_e2ee_sessions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id               UUID NOT NULL REFERENCES public.chat_rooms(id) ON DELETE CASCADE,
  sender_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  encrypted_session_key TEXT NOT NULL,   -- session key encrypted with recipient's public key
  session_version       INTEGER NOT NULL DEFAULT 1,
  sender_device_id      TEXT NOT NULL,
  recipient_device_id   TEXT NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  rotated_at            TIMESTAMPTZ,
  UNIQUE (room_id, sender_id, recipient_id, sender_device_id, recipient_device_id)
);

-- ──────────────────────────────────────────────────────────────
-- 15. chat_audit_events
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.chat_audit_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id     UUID REFERENCES public.chat_rooms(id) ON DELETE CASCADE,
  user_id     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  event_type  TEXT NOT NULL,
  metadata    JSONB NOT NULL DEFAULT '{}',
  ip_address  INET,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_room ON public.chat_audit_events(room_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_user ON public.chat_audit_events(user_id, created_at DESC);

-- ──────────────────────────────────────────────────────────────
-- 16. Realtime publications
-- ──────────────────────────────────────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_rooms;
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_room_members;
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_message_receipts;
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_message_reactions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_attachments;
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_calls;
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_call_participants;
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_presence;
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_typing_state;

ALTER TABLE public.chat_messages         REPLICA IDENTITY FULL;
ALTER TABLE public.chat_message_receipts REPLICA IDENTITY FULL;
ALTER TABLE public.chat_typing_state     REPLICA IDENTITY FULL;
ALTER TABLE public.chat_presence         REPLICA IDENTITY FULL;
ALTER TABLE public.chat_calls            REPLICA IDENTITY FULL;
ALTER TABLE public.chat_call_participants REPLICA IDENTITY FULL;

-- ──────────────────────────────────────────────────────────────
-- 17. RLS — enable
-- ──────────────────────────────────────────────────────────────
ALTER TABLE public.chat_rooms               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_room_members        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_direct_rooms        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_message_receipts    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_message_reactions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_attachments         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_calls               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_call_participants   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_presence            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_typing_state        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_device_keys         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_e2ee_sessions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_audit_events        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_room_policies       ENABLE ROW LEVEL SECURITY;

-- ──────────────────────────────────────────────────────────────
-- 18. RLS helper: is_room_member
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_is_chat_member(p_room_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.chat_room_members
    WHERE  room_id = p_room_id
    AND    user_id = p_user_id
    AND    removed_at IS NULL
  );
$$;

CREATE OR REPLACE FUNCTION public.fn_chat_member_role(p_room_id UUID, p_user_id UUID)
RETURNS public.chat_member_role
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM public.chat_room_members
  WHERE  room_id = p_room_id
  AND    user_id = p_user_id
  AND    removed_at IS NULL
  LIMIT 1;
$$;

-- ──────────────────────────────────────────────────────────────
-- 19. RLS policies
-- ──────────────────────────────────────────────────────────────

-- chat_room_policies: readable by authenticated users
DROP POLICY IF EXISTS "policies_authenticated_read" ON public.chat_room_policies;
CREATE POLICY "policies_authenticated_read" ON public.chat_room_policies
  FOR SELECT TO authenticated USING (TRUE);

-- chat_rooms: members only
DROP POLICY IF EXISTS "rooms_member_select" ON public.chat_rooms;
CREATE POLICY "rooms_member_select" ON public.chat_rooms
  FOR SELECT TO authenticated
  USING (public.fn_is_chat_member(id, auth.uid()));

DROP POLICY IF EXISTS "rooms_member_update" ON public.chat_rooms;
CREATE POLICY "rooms_member_update" ON public.chat_rooms
  FOR UPDATE TO authenticated
  USING (public.fn_is_chat_member(id, auth.uid()))
  WITH CHECK (public.fn_is_chat_member(id, auth.uid()));

DROP POLICY IF EXISTS "rooms_creator_insert" ON public.chat_rooms;
CREATE POLICY "rooms_creator_insert" ON public.chat_rooms
  FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());

-- chat_room_members: own rows + room-mates
DROP POLICY IF EXISTS "members_select" ON public.chat_room_members;
CREATE POLICY "members_select" ON public.chat_room_members
  FOR SELECT TO authenticated
  USING (public.fn_is_chat_member(room_id, auth.uid()));

DROP POLICY IF EXISTS "members_insert_self" ON public.chat_room_members;
CREATE POLICY "members_insert_self" ON public.chat_room_members
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "members_update_self" ON public.chat_room_members;
CREATE POLICY "members_update_self" ON public.chat_room_members
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- chat_direct_rooms
DROP POLICY IF EXISTS "direct_select" ON public.chat_direct_rooms;
CREATE POLICY "direct_select" ON public.chat_direct_rooms
  FOR SELECT TO authenticated
  USING (user_a_id = auth.uid() OR user_b_id = auth.uid());

DROP POLICY IF EXISTS "direct_insert" ON public.chat_direct_rooms;
CREATE POLICY "direct_insert" ON public.chat_direct_rooms
  FOR INSERT TO authenticated
  WITH CHECK (user_a_id = auth.uid() OR user_b_id = auth.uid());

-- chat_messages: members only; collab restricts send to members
DROP POLICY IF EXISTS "messages_member_select" ON public.chat_messages;
CREATE POLICY "messages_member_select" ON public.chat_messages
  FOR SELECT TO authenticated
  USING (
    public.fn_is_chat_member(room_id, auth.uid())
    AND (is_deleted = FALSE OR deleted_by = auth.uid())
  );

DROP POLICY IF EXISTS "messages_member_insert" ON public.chat_messages;
CREATE POLICY "messages_member_insert" ON public.chat_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND public.fn_is_chat_member(room_id, auth.uid())
  );

DROP POLICY IF EXISTS "messages_sender_update" ON public.chat_messages;
CREATE POLICY "messages_sender_update" ON public.chat_messages
  FOR UPDATE TO authenticated
  USING (
    sender_id = auth.uid()
    AND public.fn_is_chat_member(room_id, auth.uid())
  )
  WITH CHECK (sender_id = auth.uid());

-- chat_message_receipts
DROP POLICY IF EXISTS "receipts_member_select" ON public.chat_message_receipts;
CREATE POLICY "receipts_member_select" ON public.chat_message_receipts
  FOR SELECT TO authenticated
  USING (public.fn_is_chat_member(room_id, auth.uid()));

DROP POLICY IF EXISTS "receipts_self_upsert" ON public.chat_message_receipts;
CREATE POLICY "receipts_self_upsert" ON public.chat_message_receipts
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- chat_message_reactions
DROP POLICY IF EXISTS "reactions_member_select" ON public.chat_message_reactions;
CREATE POLICY "reactions_member_select" ON public.chat_message_reactions
  FOR SELECT TO authenticated
  USING (public.fn_is_chat_member(room_id, auth.uid()));

DROP POLICY IF EXISTS "reactions_self_all" ON public.chat_message_reactions;
CREATE POLICY "reactions_self_all" ON public.chat_message_reactions
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid() AND public.fn_is_chat_member(room_id, auth.uid()));

-- chat_attachments
DROP POLICY IF EXISTS "attachments_member_select" ON public.chat_attachments;
CREATE POLICY "attachments_member_select" ON public.chat_attachments
  FOR SELECT TO authenticated
  USING (public.fn_is_chat_member(room_id, auth.uid()));

DROP POLICY IF EXISTS "attachments_self_insert" ON public.chat_attachments;
CREATE POLICY "attachments_self_insert" ON public.chat_attachments
  FOR INSERT TO authenticated
  WITH CHECK (
    uploader_id = auth.uid()
    AND public.fn_is_chat_member(room_id, auth.uid())
  );

-- chat_calls: only merchant_private rooms
DROP POLICY IF EXISTS "calls_member_select" ON public.chat_calls;
CREATE POLICY "calls_member_select" ON public.chat_calls
  FOR SELECT TO authenticated
  USING (
    public.fn_is_chat_member(room_id, auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.chat_rooms r
      JOIN   public.chat_room_policies p ON p.id = r.policy_id
      WHERE  r.id = room_id AND p.allow_calls = TRUE
    )
  );

DROP POLICY IF EXISTS "calls_member_insert" ON public.chat_calls;
CREATE POLICY "calls_member_insert" ON public.chat_calls
  FOR INSERT TO authenticated
  WITH CHECK (
    initiated_by = auth.uid()
    AND public.fn_is_chat_member(room_id, auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.chat_rooms r
      JOIN   public.chat_room_policies p ON p.id = r.policy_id
      WHERE  r.id = room_id AND p.allow_calls = TRUE
    )
  );

DROP POLICY IF EXISTS "calls_member_update" ON public.chat_calls;
CREATE POLICY "calls_member_update" ON public.chat_calls
  FOR UPDATE TO authenticated
  USING (public.fn_is_chat_member(room_id, auth.uid()));

-- chat_call_participants
DROP POLICY IF EXISTS "call_participants_select" ON public.chat_call_participants;
CREATE POLICY "call_participants_select" ON public.chat_call_participants
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.chat_calls c
      WHERE  c.id = call_id
      AND    public.fn_is_chat_member(c.room_id, auth.uid())
    )
  );

DROP POLICY IF EXISTS "call_participants_upsert" ON public.chat_call_participants;
CREATE POLICY "call_participants_upsert" ON public.chat_call_participants
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- chat_presence
DROP POLICY IF EXISTS "presence_member_select" ON public.chat_presence;
CREATE POLICY "presence_member_select" ON public.chat_presence
  FOR SELECT TO authenticated USING (TRUE);    -- any authenticated user can see presence

DROP POLICY IF EXISTS "presence_self_upsert" ON public.chat_presence;
CREATE POLICY "presence_self_upsert" ON public.chat_presence
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- chat_typing_state
DROP POLICY IF EXISTS "typing_member_select" ON public.chat_typing_state;
CREATE POLICY "typing_member_select" ON public.chat_typing_state
  FOR SELECT TO authenticated
  USING (public.fn_is_chat_member(room_id, auth.uid()));

DROP POLICY IF EXISTS "typing_self_upsert" ON public.chat_typing_state;
CREATE POLICY "typing_self_upsert" ON public.chat_typing_state
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid() AND public.fn_is_chat_member(room_id, auth.uid()));

-- chat_device_keys: own keys read/write + public read for E2EE
DROP POLICY IF EXISTS "device_keys_select" ON public.chat_device_keys;
CREATE POLICY "device_keys_select" ON public.chat_device_keys
  FOR SELECT TO authenticated USING (TRUE);  -- peers need to read keys

DROP POLICY IF EXISTS "device_keys_self_write" ON public.chat_device_keys;
CREATE POLICY "device_keys_self_write" ON public.chat_device_keys
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- chat_e2ee_sessions
DROP POLICY IF EXISTS "e2ee_sessions_participant" ON public.chat_e2ee_sessions;
CREATE POLICY "e2ee_sessions_participant" ON public.chat_e2ee_sessions
  FOR SELECT TO authenticated
  USING (sender_id = auth.uid() OR recipient_id = auth.uid());

DROP POLICY IF EXISTS "e2ee_sessions_sender_write" ON public.chat_e2ee_sessions;
CREATE POLICY "e2ee_sessions_sender_write" ON public.chat_e2ee_sessions
  FOR ALL TO authenticated
  USING (sender_id = auth.uid())
  WITH CHECK (sender_id = auth.uid());

-- chat_audit_events
DROP POLICY IF EXISTS "audit_member_select" ON public.chat_audit_events;
CREATE POLICY "audit_member_select" ON public.chat_audit_events
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR (room_id IS NOT NULL AND public.fn_chat_member_role(room_id, auth.uid()) IN ('owner','admin'))
  );

-- ──────────────────────────────────────────────────────────────
-- 20. Core RPCs
-- ──────────────────────────────────────────────────────────────

-- 20.1 get_or_create_direct_room
CREATE OR REPLACE FUNCTION public.chat_get_or_create_direct_room(
  _other_user_id  UUID,
  _room_name      TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _me       UUID := auth.uid();
  _user_a   UUID;
  _user_b   UUID;
  _room_id  UUID;
  _policy   UUID;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _me = _other_user_id THEN RAISE EXCEPTION 'Cannot create room with yourself'; END IF;

  -- canonical ordering
  _user_a := LEAST(_me, _other_user_id);
  _user_b := GREATEST(_me, _other_user_id);

  -- look up existing
  SELECT room_id INTO _room_id
  FROM   public.chat_direct_rooms
  WHERE  user_a_id = _user_a AND user_b_id = _user_b;

  IF _room_id IS NOT NULL THEN RETURN _room_id; END IF;

  -- get policy
  SELECT id INTO _policy FROM public.chat_room_policies WHERE room_type = 'merchant_private';

  -- create room
  INSERT INTO public.chat_rooms (type, name, created_by, policy_id, is_direct)
  VALUES ('merchant_private', _room_name, _me, _policy, TRUE)
  RETURNING id INTO _room_id;

  -- register in direct map
  INSERT INTO public.chat_direct_rooms (user_a_id, user_b_id, room_id)
  VALUES (_user_a, _user_b, _room_id);

  -- add both members
  INSERT INTO public.chat_room_members (room_id, user_id, role)
  VALUES (_room_id, _me,            'owner'),
         (_room_id, _other_user_id, 'member')
  ON CONFLICT (room_id, user_id) DO NOTHING;

  -- audit
  INSERT INTO public.chat_audit_events (room_id, user_id, event_type, metadata)
  VALUES (_room_id, _me, 'room_created', jsonb_build_object('other_user_id', _other_user_id));

  RETURN _room_id;
END;
$$;

-- 20.2 create_merchant_client_room (merchant + customer)
CREATE OR REPLACE FUNCTION public.chat_create_merchant_client_room(
  _customer_user_id  UUID,
  _room_name         TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _me       UUID := auth.uid();
  _room_id  UUID;
  _policy   UUID;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT id INTO _policy FROM public.chat_room_policies WHERE room_type = 'merchant_client';

  INSERT INTO public.chat_rooms (type, name, created_by, policy_id, is_direct)
  VALUES ('merchant_client', _room_name, _me, _policy, TRUE)
  RETURNING id INTO _room_id;

  INSERT INTO public.chat_room_members (room_id, user_id, role)
  VALUES (_room_id, _me,               'owner'),
         (_room_id, _customer_user_id, 'member')
  ON CONFLICT (room_id, user_id) DO NOTHING;

  INSERT INTO public.chat_audit_events (room_id, user_id, event_type, metadata)
  VALUES (_room_id, _me, 'room_created', jsonb_build_object('customer_user_id', _customer_user_id));

  RETURN _room_id;
END;
$$;

-- 20.3 send_message  (idempotent via client_nonce)
CREATE OR REPLACE FUNCTION public.chat_send_message(
  _room_id            UUID,
  _content            TEXT,
  _type               public.chat_message_type DEFAULT 'text',
  _metadata           JSONB   DEFAULT '{}',
  _reply_to_id        UUID    DEFAULT NULL,
  _client_nonce       TEXT    DEFAULT NULL,
  _expires_at         TIMESTAMPTZ DEFAULT NULL,
  _view_once          BOOLEAN DEFAULT FALSE,
  _watermark_text     TEXT    DEFAULT NULL
)
RETURNS SETOF public.chat_messages
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _me  UUID := auth.uid();
  _msg public.chat_messages;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.fn_is_chat_member(_room_id, _me) THEN
    RAISE EXCEPTION 'Not a member of room %', _room_id;
  END IF;

  -- idempotency: return existing if nonce already used
  IF _client_nonce IS NOT NULL THEN
    SELECT * INTO _msg FROM public.chat_messages
    WHERE client_nonce = _client_nonce LIMIT 1;
    IF FOUND THEN RETURN NEXT _msg; RETURN; END IF;
  END IF;

  INSERT INTO public.chat_messages
    (room_id, sender_id, type, content, metadata, reply_to_id,
     client_nonce, expires_at, view_once, watermark_text)
  VALUES
    (_room_id, _me, _type, _content, _metadata, _reply_to_id,
     _client_nonce, _expires_at, _view_once, _watermark_text)
  RETURNING * INTO _msg;

  -- update room last_message
  UPDATE public.chat_rooms
  SET    last_message_id      = _msg.id,
         last_message_at      = _msg.created_at,
         last_message_preview = left(_content, 120),
         updated_at           = now()
  WHERE  id = _room_id;

  -- deliver receipt for sender
  INSERT INTO public.chat_message_receipts (message_id, room_id, user_id, status)
  VALUES (_msg.id, _room_id, _me, 'read')
  ON CONFLICT (message_id, user_id) DO NOTHING;

  RETURN NEXT _msg;
END;
$$;

-- 20.4 mark_room_read
CREATE OR REPLACE FUNCTION public.chat_mark_room_read(
  _room_id          UUID,
  _up_to_message_id UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _me UUID := auth.uid();
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  -- upsert receipts for all unread messages up to the given message
  INSERT INTO public.chat_message_receipts (message_id, room_id, user_id, status, updated_at)
  SELECT m.id, _room_id, _me, 'read', now()
  FROM   public.chat_messages m
  WHERE  m.room_id = _room_id
  AND    m.is_deleted = FALSE
  AND    (_up_to_message_id IS NULL OR m.created_at <=
          (SELECT created_at FROM public.chat_messages WHERE id = _up_to_message_id))
  ON CONFLICT (message_id, user_id)
  DO UPDATE SET status = 'read', updated_at = now()
  WHERE  chat_message_receipts.status <> 'read';

  -- update member read state
  UPDATE public.chat_room_members
  SET    last_read_message_id = COALESCE(
           _up_to_message_id,
           (SELECT id FROM public.chat_messages
            WHERE room_id = _room_id AND is_deleted = FALSE
            ORDER BY created_at DESC LIMIT 1)
         ),
         last_read_at = now()
  WHERE  room_id = _room_id AND user_id = _me;
END;
$$;

-- 20.5 delete_message (for everyone or just sender)
CREATE OR REPLACE FUNCTION public.chat_delete_message(
  _message_id     UUID,
  _for_everyone   BOOLEAN DEFAULT FALSE
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _me   UUID := auth.uid();
  _role public.chat_member_role;
  _msg  public.chat_messages;
BEGIN
  SELECT * INTO _msg FROM public.chat_messages WHERE id = _message_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Message not found'; END IF;

  _role := public.fn_chat_member_role(_msg.room_id, _me);
  IF _role IS NULL THEN RAISE EXCEPTION 'Not a member'; END IF;

  IF _for_everyone THEN
    -- only sender or admins/owners
    IF _msg.sender_id <> _me AND _role NOT IN ('owner','admin') THEN
      RAISE EXCEPTION 'Insufficient permissions to delete for everyone';
    END IF;
    UPDATE public.chat_messages
    SET    is_deleted = TRUE, deleted_at = now(), deleted_by = _me,
           content = '', metadata = '{}', updated_at = now()
    WHERE  id = _message_id;
  ELSE
    UPDATE public.chat_messages
    SET    deleted_for_sender = TRUE, updated_at = now()
    WHERE  id = _message_id AND sender_id = _me;
  END IF;
END;
$$;

-- 20.6 edit_message
CREATE OR REPLACE FUNCTION public.chat_edit_message(
  _message_id  UUID,
  _new_content TEXT
)
RETURNS SETOF public.chat_messages
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _me  UUID := auth.uid();
  _msg public.chat_messages;
BEGIN
  SELECT * INTO _msg FROM public.chat_messages WHERE id = _message_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Message not found'; END IF;
  IF _msg.sender_id <> _me THEN RAISE EXCEPTION 'Cannot edit another user''s message'; END IF;
  IF _msg.view_once THEN RAISE EXCEPTION 'Cannot edit one-time-view messages'; END IF;

  UPDATE public.chat_messages
  SET    content    = _new_content,
         is_edited  = TRUE,
         edited_at  = now(),
         updated_at = now()
  WHERE  id = _message_id
  RETURNING * INTO _msg;

  RETURN NEXT _msg;
END;
$$;

-- 20.7 add / remove reaction
CREATE OR REPLACE FUNCTION public.chat_add_reaction(
  _message_id UUID,
  _emoji      TEXT
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _me      UUID := auth.uid();
  _room_id UUID;
BEGIN
  SELECT room_id INTO _room_id FROM public.chat_messages WHERE id = _message_id;
  IF NOT public.fn_is_chat_member(_room_id, _me) THEN RAISE EXCEPTION 'Not a member'; END IF;

  INSERT INTO public.chat_message_reactions (message_id, room_id, user_id, emoji)
  VALUES (_message_id, _room_id, _me, _emoji)
  ON CONFLICT (message_id, user_id, emoji) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.chat_remove_reaction(
  _message_id UUID,
  _emoji      TEXT
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM public.chat_message_reactions
  WHERE  message_id = _message_id
  AND    user_id    = auth.uid()
  AND    emoji      = _emoji;
END;
$$;

-- 20.8 upsert_typing
CREATE OR REPLACE FUNCTION public.chat_set_typing(
  _room_id   UUID,
  _is_typing BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _me UUID := auth.uid();
BEGIN
  IF NOT public.fn_is_chat_member(_room_id, _me) THEN RAISE EXCEPTION 'Not a member'; END IF;

  INSERT INTO public.chat_typing_state (room_id, user_id, is_typing, expires_at, updated_at)
  VALUES (_room_id, _me, _is_typing, now() + interval '8 seconds', now())
  ON CONFLICT (room_id, user_id) DO UPDATE
    SET is_typing  = EXCLUDED.is_typing,
        expires_at = EXCLUDED.expires_at,
        updated_at = now();
END;
$$;

-- 20.9 upsert_presence
CREATE OR REPLACE FUNCTION public.chat_set_presence(
  _status      TEXT DEFAULT 'online',
  _device_info JSONB DEFAULT '{}'
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _me UUID := auth.uid();
BEGIN
  INSERT INTO public.chat_presence (user_id, status, last_seen_at, device_info, updated_at)
  VALUES (_me, _status, now(), _device_info, now())
  ON CONFLICT (user_id) DO UPDATE
    SET status       = EXCLUDED.status,
        last_seen_at = now(),
        device_info  = EXCLUDED.device_info,
        updated_at   = now();
END;
$$;

-- 20.10 get_rooms (with unread counts)
CREATE OR REPLACE FUNCTION public.chat_get_rooms()
RETURNS TABLE (
  room_id            UUID,
  room_type          public.chat_room_type,
  name               TEXT,
  avatar_url         TEXT,
  is_direct          BOOLEAN,
  last_message_at    TIMESTAMPTZ,
  last_message_preview TEXT,
  unread_count       BIGINT,
  is_muted           BOOLEAN,
  is_pinned          BOOLEAN,
  is_archived        BOOLEAN,
  member_count       BIGINT,
  other_user_id      UUID,
  other_user_metadata JSONB
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    r.id                     AS room_id,
    r.type                   AS room_type,
    r.name                   AS name,
    r.avatar_url             AS avatar_url,
    r.is_direct              AS is_direct,
    r.last_message_at        AS last_message_at,
    r.last_message_preview   AS last_message_preview,
    -- unread count: messages after last_read_message
    COALESCE((
      SELECT COUNT(*)
      FROM   public.chat_messages m
      WHERE  m.room_id    = r.id
      AND    m.is_deleted = FALSE
      AND    m.sender_id <> auth.uid()
      AND    NOT EXISTS (
        SELECT 1 FROM public.chat_message_receipts rcpt
        WHERE  rcpt.message_id = m.id
        AND    rcpt.user_id    = auth.uid()
        AND    rcpt.status     = 'read'
      )
    ), 0)                    AS unread_count,
    mem.is_muted             AS is_muted,
    mem.is_pinned            AS is_pinned,
    mem.is_archived          AS is_archived,
    -- member count
    (SELECT COUNT(*) FROM public.chat_room_members m2
     WHERE m2.room_id = r.id AND m2.removed_at IS NULL) AS member_count,
    -- for direct rooms: the other user
    CASE WHEN r.is_direct THEN (
      SELECT m2.user_id FROM public.chat_room_members m2
      WHERE  m2.room_id = r.id AND m2.user_id <> auth.uid() AND m2.removed_at IS NULL
      LIMIT  1
    ) END                    AS other_user_id,
    '{}'::JSONB              AS other_user_metadata
  FROM  public.chat_rooms r
  JOIN  public.chat_room_members mem
        ON  mem.room_id = r.id
        AND mem.user_id = auth.uid()
        AND mem.removed_at IS NULL
  WHERE mem.is_archived = FALSE
  ORDER BY COALESCE(r.last_message_at, r.created_at) DESC;
$$;

-- 20.11 mark_one_time_viewed
CREATE OR REPLACE FUNCTION public.chat_mark_viewed(
  _message_id UUID
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _me UUID := auth.uid();
BEGIN
  UPDATE public.chat_messages
  SET    viewed_by = array_append(
           CASE WHEN _me = ANY(viewed_by) THEN viewed_by ELSE viewed_by END,
           _me
         )
  WHERE  id = _message_id
  AND    view_once = TRUE
  AND    NOT (_me = ANY(viewed_by));
END;
$$;

-- 20.12 initiate_call (Phase 4)
CREATE OR REPLACE FUNCTION public.chat_initiate_call(
  _room_id UUID
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _me      UUID := auth.uid();
  _call_id UUID;
  _policy  RECORD;
BEGIN
  -- verify calls allowed in this room type
  SELECT p.allow_calls INTO _policy
  FROM   public.chat_rooms r
  JOIN   public.chat_room_policies p ON p.id = r.policy_id
  WHERE  r.id = _room_id;

  IF NOT _policy.allow_calls THEN
    RAISE EXCEPTION 'Calls not permitted in this room type';
  END IF;

  IF NOT public.fn_is_chat_member(_room_id, _me) THEN
    RAISE EXCEPTION 'Not a member';
  END IF;

  -- cancel any existing ringing call in the same room
  UPDATE public.chat_calls
  SET    status = 'missed', ended_at = now()
  WHERE  room_id = _room_id AND status = 'ringing';

  INSERT INTO public.chat_calls (room_id, initiated_by, status)
  VALUES (_room_id, _me, 'ringing')
  RETURNING id INTO _call_id;

  -- add initiator as participant
  INSERT INTO public.chat_call_participants (call_id, user_id, status, joined_at)
  VALUES (_call_id, _me, 'connected', now());

  -- ring all other members
  INSERT INTO public.chat_call_participants (call_id, user_id, status)
  SELECT _call_id, m.user_id, 'ringing'
  FROM   public.chat_room_members m
  WHERE  m.room_id = _room_id
  AND    m.user_id <> _me
  AND    m.removed_at IS NULL;

  -- send system message
  PERFORM public.chat_send_message(
    _room_id, '📞 Call started', 'system',
    jsonb_build_object('call_id', _call_id, 'event', 'call_initiated'),
    NULL, gen_random_uuid()::text
  );

  RETURN _call_id;
END;
$$;

-- 20.13 answer_call
CREATE OR REPLACE FUNCTION public.chat_answer_call(
  _call_id    UUID,
  _sdp_answer TEXT
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _me UUID := auth.uid();
BEGIN
  UPDATE public.chat_call_participants
  SET    status = 'connected', joined_at = now(), sdp_answer = _sdp_answer
  WHERE  call_id = _call_id AND user_id = _me;

  UPDATE public.chat_calls
  SET    status = 'active', connected_at = now()
  WHERE  id = _call_id AND status = 'ringing';
END;
$$;

-- 20.14 end_call
CREATE OR REPLACE FUNCTION public.chat_end_call(
  _call_id   UUID,
  _end_reason TEXT DEFAULT 'ended'
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _me      UUID := auth.uid();
  _room_id UUID;
  _dur     INTEGER;
BEGIN
  SELECT room_id,
         EXTRACT(EPOCH FROM (now() - connected_at))::INTEGER
  INTO   _room_id, _dur
  FROM   public.chat_calls
  WHERE  id = _call_id;

  UPDATE public.chat_calls
  SET    status           = CASE WHEN _end_reason = 'declined' THEN 'declined'::public.chat_call_status
                                 WHEN _end_reason = 'missed'   THEN 'missed'::public.chat_call_status
                                 ELSE 'ended'::public.chat_call_status END,
         ended_at         = now(),
         duration_seconds = GREATEST(_dur, 0),
         end_reason       = _end_reason
  WHERE  id = _call_id;

  UPDATE public.chat_call_participants
  SET    status  = 'disconnected',
         left_at = now()
  WHERE  call_id = _call_id AND user_id = _me;

  -- post summary message
  IF _end_reason NOT IN ('declined', 'missed') THEN
    PERFORM public.chat_send_message(
      _room_id,
      '📞 Call ended · ' || COALESCE(_dur::text || 's', '0s'),
      'call_summary',
      jsonb_build_object('call_id', _call_id, 'duration_seconds', _dur),
      NULL, gen_random_uuid()::text
    );
  END IF;
END;
$$;

-- 20.15 push ICE candidate
CREATE OR REPLACE FUNCTION public.chat_push_ice_candidate(
  _call_id   UUID,
  _candidate JSONB
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.chat_call_participants
  SET    ice_candidates = ice_candidates || _candidate
  WHERE  call_id = _call_id AND user_id = auth.uid();
END;
$$;

-- 20.16 create_collab_room (single all-merchant collab room)
CREATE OR REPLACE FUNCTION public.chat_get_or_create_collab_room(
  _name TEXT DEFAULT 'Merchants Hub'
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _me      UUID := auth.uid();
  _room_id UUID;
  _policy  UUID;
BEGIN
  -- Try to find an existing collab room this user is a member of
  SELECT r.id INTO _room_id
  FROM   public.chat_rooms r
  JOIN   public.chat_room_members m ON m.room_id = r.id AND m.user_id = _me AND m.removed_at IS NULL
  WHERE  r.type = 'merchant_collab'
  LIMIT  1;

  IF _room_id IS NOT NULL THEN RETURN _room_id; END IF;

  -- If global collab room exists but user is not a member, join it
  SELECT r.id INTO _room_id
  FROM   public.chat_rooms r
  WHERE  r.type = 'merchant_collab'
  AND    r.is_announcement_only = FALSE
  ORDER  BY r.created_at ASC
  LIMIT  1;

  IF _room_id IS NOT NULL THEN
    INSERT INTO public.chat_room_members (room_id, user_id, role)
    VALUES (_room_id, _me, 'member')
    ON CONFLICT (room_id, user_id) DO UPDATE
      SET removed_at = NULL, role = 'member';
    RETURN _room_id;
  END IF;

  -- Create the global collab room
  SELECT id INTO _policy FROM public.chat_room_policies WHERE room_type = 'merchant_collab';

  INSERT INTO public.chat_rooms (type, name, created_by, policy_id, is_direct)
  VALUES ('merchant_collab', _name, _me, _policy, FALSE)
  RETURNING id INTO _room_id;

  INSERT INTO public.chat_room_members (room_id, user_id, role)
  VALUES (_room_id, _me, 'owner');

  RETURN _room_id;
END;
$$;

-- ──────────────────────────────────────────────────────────────
-- 21. Trigger: auto-deliver receipts to members when message inserted
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_chat_deliver_receipts()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Insert 'delivered' receipt for all members except sender
  INSERT INTO public.chat_message_receipts (message_id, room_id, user_id, status, updated_at)
  SELECT NEW.id, NEW.room_id, m.user_id, 'delivered', now()
  FROM   public.chat_room_members m
  WHERE  m.room_id    = NEW.room_id
  AND    m.user_id   <> NEW.sender_id
  AND    m.removed_at IS NULL
  ON CONFLICT (message_id, user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_chat_deliver_receipts ON public.chat_messages;
CREATE TRIGGER trg_chat_deliver_receipts
  AFTER INSERT ON public.chat_messages
  FOR EACH ROW EXECUTE FUNCTION public.fn_chat_deliver_receipts();

-- ──────────────────────────────────────────────────────────────
-- 22. Trigger: clean up expired messages
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_chat_expire_messages()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- soft-delete expired messages
  UPDATE public.chat_messages
  SET    is_deleted  = TRUE,
         deleted_at  = now(),
         content     = '',
         metadata    = '{}',
         updated_at  = now()
  WHERE  expires_at < now()
  AND    is_deleted = FALSE;

  RETURN NULL;
END;
$$;

-- ──────────────────────────────────────────────────────────────
-- 23. Trigger: notification on new message
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_chat_notify_new_message()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _member   RECORD;
  _sender   TEXT;
BEGIN
  -- skip system messages
  IF NEW.type = 'system' THEN RETURN NEW; END IF;

  -- get sender display name
  SELECT COALESCE(mp.display_name, p.full_name, 'Someone') INTO _sender
  FROM   auth.users u
  LEFT   JOIN public.merchant_profiles mp ON mp.user_id = u.id
  LEFT   JOIN public.profiles p           ON p.user_id  = u.id
  WHERE  u.id = NEW.sender_id
  LIMIT  1;

  -- notify all members except sender
  FOR _member IN
    SELECT m.user_id
    FROM   public.chat_room_members m
    WHERE  m.room_id    = NEW.room_id
    AND    m.user_id   <> NEW.sender_id
    AND    m.removed_at IS NULL
    AND    m.notification_level <> 'none'
    AND    (m.is_muted = FALSE OR (m.muted_until IS NOT NULL AND m.muted_until < now()))
  LOOP
    INSERT INTO public.notifications (
      user_id, category, title, body,
      actor_id, conversation_id, message_id,
      target_path, target_tab, target_focus,
      target_entity_type, target_entity_id,
      dedupe_key
    ) VALUES (
      _member.user_id, 'message',
      _sender,
      left(CASE WHEN NEW.type = 'text' THEN NEW.content
                WHEN NEW.type = 'voice_note' THEN '🎙 Voice message'
                WHEN NEW.type = 'image' THEN '🖼 Image'
                WHEN NEW.type = 'file' THEN '📎 File'
                ELSE NEW.type::text END, 80),
      NEW.sender_id, NEW.room_id, NEW.id,
      '/chat', NULL, NULL,
      'chat_message', NEW.id::text,
      'chat:' || NEW.room_id::text || ':' || _member.user_id::text
    )
    ON CONFLICT DO NOTHING;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_chat_notify_new_message ON public.chat_messages;
CREATE TRIGGER trg_chat_notify_new_message
  AFTER INSERT ON public.chat_messages
  FOR EACH ROW EXECUTE FUNCTION public.fn_chat_notify_new_message();

-- ──────────────────────────────────────────────────────────────
-- 24. Trigger: update updated_at on edit
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$;

DO $$
DECLARE
  _t TEXT;
BEGIN
  FOREACH _t IN ARRAY ARRAY[
    'chat_rooms', 'chat_room_members', 'chat_messages',
    'chat_room_policies', 'chat_presence', 'chat_typing_state'
  ] LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_%s_updated_at ON public.%s; ' ||
      'CREATE TRIGGER trg_%s_updated_at BEFORE UPDATE ON public.%s ' ||
      'FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at()',
      _t, _t, _t, _t
    );
  END LOOP;
END;
$$;

-- ──────────────────────────────────────────────────────────────
-- 25. DATA MIGRATION
-- ──────────────────────────────────────────────────────────────

-- 25.1 Migrate os_rooms → chat_rooms (merchant_private)
INSERT INTO public.chat_rooms
  (id, type, name, created_by, is_direct, last_message_at, migrated_from, migrated_source_id, created_at, updated_at)
SELECT
  r.id,
  'merchant_private'::public.chat_room_type,
  r.name,
  -- owner: first os_room_members with role 'owner', fallback to first member
  (SELECT mp.user_id FROM public.os_room_members m
   JOIN   public.merchant_profiles mp ON mp.merchant_id = m.merchant_id
   WHERE  m.room_id = r.id
   ORDER  BY CASE WHEN m.role = 'owner' THEN 0 ELSE 1 END, m.joined_at ASC
   LIMIT  1),
  TRUE,
  r.last_message_at,
  'os_rooms',
  r.id,
  r.created_at,
  r.updated_at
FROM public.os_rooms r
ON CONFLICT (id) DO NOTHING;

-- Set policy_id for migrated rooms
UPDATE public.chat_rooms cr
SET    policy_id = (SELECT id FROM public.chat_room_policies WHERE room_type = cr.type)
WHERE  policy_id IS NULL AND migrated_from = 'os_rooms';

-- 25.2 Migrate os_room_members → chat_room_members
INSERT INTO public.chat_room_members
  (room_id, user_id, role, joined_at)
SELECT
  m.room_id,
  mp.user_id,
  CASE m.role
    WHEN 'owner'  THEN 'owner'::public.chat_member_role
    WHEN 'admin'  THEN 'admin'::public.chat_member_role
    ELSE               'member'::public.chat_member_role
  END,
  m.joined_at
FROM   public.os_room_members m
JOIN   public.merchant_profiles mp ON mp.merchant_id = m.merchant_id
WHERE  EXISTS (SELECT 1 FROM public.chat_rooms WHERE id = m.room_id)
ON CONFLICT (room_id, user_id) DO NOTHING;

-- 25.3 Migrate os_messages → chat_messages
INSERT INTO public.chat_messages
  (id, room_id, sender_id, type, content, metadata, reply_to_id,
   client_nonce, expires_at, created_at, updated_at)
SELECT
  m.id,
  m.room_id,
  COALESCE(m.sender_id, mp.user_id, '00000000-0000-0000-0000-000000000000'::UUID),
  CASE m.message_type
    WHEN 'voice' THEN 'voice_note'::public.chat_message_type
    WHEN 'image' THEN 'image'::public.chat_message_type
    WHEN 'file'  THEN 'file'::public.chat_message_type
    ELSE              'text'::public.chat_message_type
  END,
  COALESCE(m.content, ''),
  COALESCE(m.body_json, '{}'),
  m.reply_to_message_id,
  m.client_nonce,
  m.expires_at,
  m.created_at,
  m.created_at
FROM   public.os_messages m
LEFT   JOIN public.merchant_profiles mp ON mp.merchant_id = m.sender_merchant_id
WHERE  EXISTS (SELECT 1 FROM public.chat_rooms WHERE id = m.room_id)
ON CONFLICT (id) DO NOTHING;

-- 25.4 Migrate os_messages read state → receipts
INSERT INTO public.chat_message_receipts
  (message_id, room_id, user_id, status, updated_at)
SELECT
  m.id,
  m.room_id,
  COALESCE(m.sender_id, mp.user_id),
  CASE WHEN m.read_at IS NOT NULL THEN 'read' ELSE 'delivered' END,
  COALESCE(m.read_at, m.created_at)
FROM   public.os_messages m
LEFT   JOIN public.merchant_profiles mp ON mp.merchant_id = m.sender_merchant_id
WHERE  EXISTS (SELECT 1 FROM public.chat_rooms WHERE id = m.room_id)
AND    COALESCE(m.sender_id, mp.user_id) IS NOT NULL
ON CONFLICT (message_id, user_id) DO NOTHING;

-- 25.5 Migrate message_reactions → chat_message_reactions
INSERT INTO public.chat_message_reactions
  (id, message_id, room_id, user_id, emoji, created_at)
SELECT
  r.id,
  r.message_id,
  m.room_id,
  u.id,
  r.reaction,
  r.created_at
FROM   public.message_reactions r
JOIN   public.chat_messages m     ON m.id = r.message_id
LEFT   JOIN public.merchant_profiles mp ON mp.merchant_id = r.user_id
LEFT   JOIN auth.users u ON u.id = mp.user_id
WHERE  u.id IS NOT NULL
ON CONFLICT (message_id, user_id, emoji) DO NOTHING;

-- 25.6 Migrate customer_merchant_connections + customer_messages → chat_rooms + chat_messages
DO $$
DECLARE
  _conn   RECORD;
  _room_id UUID;
  _policy  UUID;
  _merchant_uid UUID;
BEGIN
  SELECT id INTO _policy FROM public.chat_room_policies WHERE room_type = 'merchant_client';

  FOR _conn IN SELECT * FROM public.customer_merchant_connections WHERE status <> 'blocked' LOOP
    -- resolve merchant user_id
    SELECT user_id INTO _merchant_uid
    FROM   public.merchant_profiles
    WHERE  merchant_id = _conn.merchant_id
    LIMIT  1;

    IF _merchant_uid IS NULL THEN CONTINUE; END IF;

    -- create or find room
    INSERT INTO public.chat_rooms
      (type, created_by, policy_id, is_direct, migrated_from, migrated_source_id, created_at)
    VALUES
      ('merchant_client', _merchant_uid, _policy, TRUE,
       'customer_chat', _conn.id, _conn.created_at)
    ON CONFLICT DO NOTHING
    RETURNING id INTO _room_id;

    IF _room_id IS NULL THEN
      SELECT id INTO _room_id
      FROM   public.chat_rooms
      WHERE  migrated_source_id = _conn.id AND migrated_from = 'customer_chat';
    END IF;

    IF _room_id IS NULL THEN CONTINUE; END IF;

    -- add members
    INSERT INTO public.chat_room_members (room_id, user_id, role, joined_at)
    VALUES
      (_room_id, _merchant_uid,         'owner',  _conn.created_at),
      (_room_id, _conn.customer_user_id,'member', _conn.created_at)
    ON CONFLICT (room_id, user_id) DO NOTHING;

    -- migrate messages
    INSERT INTO public.chat_messages
      (room_id, sender_id, type, content, created_at, updated_at)
    SELECT
      _room_id,
      CASE WHEN cm.sender_role = 'merchant' THEN _merchant_uid
           ELSE cm.sender_user_id END,
      'text',
      COALESCE(cm.content, ''),
      cm.created_at,
      cm.created_at
    FROM   public.customer_messages cm
    WHERE  cm.connection_id = _conn.id
    ON CONFLICT DO NOTHING;

  END LOOP;
END;
$$;

-- ──────────────────────────────────────────────────────────────
-- 26. Storage bucket for chat attachments
-- ──────────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'chat-attachments',
  'chat-attachments',
  FALSE,           -- private: all access via signed URLs
  104857600,       -- 100 MB max per file
  ARRAY[
    'image/jpeg','image/png','image/gif','image/webp','image/heic',
    'video/mp4','video/webm',
    'audio/mpeg','audio/ogg','audio/wav','audio/webm','audio/mp4',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain','text/csv'
  ]
)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS: members of the room can read; uploader can upload
DROP POLICY IF EXISTS "chat_attachments_read" ON storage.objects;
CREATE POLICY "chat_attachments_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'chat-attachments'
    AND EXISTS (
      SELECT 1 FROM public.chat_attachments a
      WHERE  a.storage_path = name
      AND    public.fn_is_chat_member(a.room_id, auth.uid())
    )
  );

DROP POLICY IF EXISTS "chat_attachments_upload" ON storage.objects;
CREATE POLICY "chat_attachments_upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'chat-attachments');

DROP POLICY IF EXISTS "chat_attachments_delete" ON storage.objects;
CREATE POLICY "chat_attachments_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'chat-attachments'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- ──────────────────────────────────────────────────────────────
-- 27. Search function (Phase 5 / collab)
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.chat_search_messages(
  _room_id UUID,
  _query   TEXT,
  _limit   INT DEFAULT 40
)
RETURNS SETOF public.chat_messages
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT m.*
  FROM   public.chat_messages m
  WHERE  m.room_id    = _room_id
  AND    m.is_deleted = FALSE
  AND    public.fn_is_chat_member(_room_id, auth.uid())
  AND    m.search_vector @@ plainto_tsquery('english', _query)
  ORDER  BY ts_rank(m.search_vector, plainto_tsquery('english', _query)) DESC,
            m.created_at DESC
  LIMIT  _limit;
$$;

-- ──────────────────────────────────────────────────────────────
-- Done
-- ──────────────────────────────────────────────────────────────
