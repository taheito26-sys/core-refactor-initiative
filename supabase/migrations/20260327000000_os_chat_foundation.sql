-- ─────────────────────────────────────────────────────────────────────────────
-- OS Chat Foundation
-- Creates os_rooms, os_room_members, os_messages, os_business_objects.
-- These tables were originally applied via scripts/migrations/001+002 on the
-- old project and are referenced by all subsequent chat migrations.
-- Uses IF NOT EXISTS / DO-EXCEPTION blocks so it is fully idempotent.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── os_rooms ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.os_rooms (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT,
  type              TEXT        NOT NULL DEFAULT 'standard',
  lane              TEXT        NOT NULL DEFAULT 'Personal',
  order_id          TEXT,
  security_policies JSONB       DEFAULT '{
    "disable_forwarding": false,
    "disable_copy": false,
    "disable_export": false,
    "disable_screenshots": false,
    "watermark": false
  }'::jsonb,
  retention_policy  TEXT        DEFAULT 'indefinite',
  last_message_at   TIMESTAMPTZ DEFAULT now(),
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);

-- ── os_room_members ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.os_room_members (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id     UUID        REFERENCES public.os_rooms(id) ON DELETE CASCADE,
  merchant_id TEXT        NOT NULL,
  role        TEXT        DEFAULT 'member',
  joined_at   TIMESTAMPTZ DEFAULT now(),
  UNIQUE (room_id, merchant_id)
);

-- ── os_messages ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.os_messages (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id                UUID        REFERENCES public.os_rooms(id) ON DELETE CASCADE,
  sender_merchant_id     TEXT,
  sender_id              UUID,
  content                TEXT,
  body_json              JSONB       DEFAULT '{}'::jsonb,
  message_type           TEXT        DEFAULT 'text',
  status                 TEXT        DEFAULT 'sent',
  permissions            JSONB       DEFAULT '{
    "forwardable": true,
    "exportable": true,
    "copyable": true,
    "ai_readable": true
  }'::jsonb,
  read_at                TIMESTAMPTZ,
  expires_at             TIMESTAMPTZ,
  deleted_for_everyone_at TIMESTAMPTZ,
  reply_to_message_id    UUID        REFERENCES public.os_messages(id) ON DELETE SET NULL,
  client_nonce           TEXT        UNIQUE,
  retention_policy       TEXT        DEFAULT 'indefinite',
  view_limit             INT,
  thread_id              UUID,
  created_at             TIMESTAMPTZ DEFAULT now()
);

-- ── os_business_objects ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.os_business_objects (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id                 UUID        REFERENCES public.os_rooms(id) ON DELETE CASCADE,
  object_type             TEXT        NOT NULL,
  created_by_merchant_id  TEXT,
  source_message_id       UUID        REFERENCES public.os_messages(id) ON DELETE SET NULL,
  payload                 JSONB       DEFAULT '{}'::jsonb,
  status                  TEXT        DEFAULT 'pending',
  state_snapshot_hash     TEXT,
  created_at              TIMESTAMPTZ DEFAULT now(),
  updated_at              TIMESTAMPTZ DEFAULT now()
);

-- ── Realtime ──────────────────────────────────────────────────────────────────
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.os_rooms;
EXCEPTION WHEN duplicate_object THEN NULL;
           WHEN undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.os_messages;
EXCEPTION WHEN duplicate_object THEN NULL;
           WHEN undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.os_room_members;
EXCEPTION WHEN duplicate_object THEN NULL;
           WHEN undefined_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.os_business_objects;
EXCEPTION WHEN duplicate_object THEN NULL;
           WHEN undefined_object THEN NULL;
END $$;
