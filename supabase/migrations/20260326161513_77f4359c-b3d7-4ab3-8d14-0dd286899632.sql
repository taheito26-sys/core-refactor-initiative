
-- ═══════════════════════════════════════════════════════════════
-- Messaging OS: Core Tables
-- ═══════════════════════════════════════════════════════════════

-- 1. os_rooms
CREATE TABLE IF NOT EXISTS public.os_rooms (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  type            TEXT NOT NULL DEFAULT 'standard'
                    CHECK (type IN ('standard','broadcast','approval','incident','deal','temporary')),
  lane            TEXT NOT NULL DEFAULT 'Personal'
                    CHECK (lane IN ('Personal','Team','Customers','Deals','Alerts','Archived')),
  security_policies JSONB NOT NULL DEFAULT '{"disable_forwarding":false,"disable_copy":false,"disable_export":false,"watermark":false}'::jsonb,
  retention_policy TEXT NOT NULL DEFAULT 'indefinite'
                    CHECK (retention_policy IN ('indefinite','30d','7d','24h','view_once')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. os_room_members
CREATE TABLE IF NOT EXISTS public.os_room_members (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id     UUID NOT NULL REFERENCES public.os_rooms(id) ON DELETE CASCADE,
  merchant_id TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'member'
                CHECK (role IN ('owner','admin','member','guest')),
  joined_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (room_id, merchant_id)
);

-- 3. os_channel_identities
CREATE TABLE IF NOT EXISTS public.os_channel_identities (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id       TEXT NOT NULL,
  provider_type     TEXT NOT NULL CHECK (provider_type IN ('WhatsApp','Web','Telegram','Email','SMS')),
  provider_uid      TEXT NOT NULL,
  confidence_level  TEXT NOT NULL DEFAULT 'certain'
                      CHECK (confidence_level IN ('certain','probable','unresolved')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (merchant_id, provider_type, provider_uid)
);

-- 4. os_threads
CREATE TABLE IF NOT EXISTS public.os_threads (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id         UUID NOT NULL REFERENCES public.os_rooms(id) ON DELETE CASCADE,
  title           TEXT,
  routing_target  TEXT,
  source_message_ids UUID[] DEFAULT '{}',
  created_by_merchant_id TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. os_messages
CREATE TABLE IF NOT EXISTS public.os_messages (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id             UUID NOT NULL REFERENCES public.os_rooms(id) ON DELETE CASCADE,
  thread_id           UUID REFERENCES public.os_threads(id) ON DELETE SET NULL,
  sender_merchant_id  TEXT NOT NULL,
  sender_identity_id  UUID REFERENCES public.os_channel_identities(id) ON DELETE SET NULL,
  content             TEXT NOT NULL,
  permissions         JSONB NOT NULL DEFAULT '{"forwardable":true,"exportable":true,"copyable":true,"ai_readable":true}'::jsonb,
  expires_at          TIMESTAMPTZ,
  retention_policy    TEXT NOT NULL DEFAULT 'indefinite'
                        CHECK (retention_policy IN ('indefinite','30d','7d','24h','view_once')),
  view_limit          INT,
  read_at             TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 6. os_business_objects
CREATE TABLE IF NOT EXISTS public.os_business_objects (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id                 UUID NOT NULL REFERENCES public.os_rooms(id) ON DELETE CASCADE,
  object_type             TEXT NOT NULL
                            CHECK (object_type IN ('order','payment','agreement','dispute','task','deal_offer','snapshot')),
  source_message_id       UUID REFERENCES public.os_messages(id) ON DELETE SET NULL,
  created_by_merchant_id  TEXT NOT NULL,
  state_snapshot_hash     TEXT,
  payload                 JSONB NOT NULL DEFAULT '{}'::jsonb,
  status                  TEXT NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending','accepted','rejected','completed','locked')),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 7. os_policies
CREATE TABLE IF NOT EXISTS public.os_policies (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id     UUID REFERENCES public.os_rooms(id) ON DELETE CASCADE,
  policy_type TEXT NOT NULL CHECK (policy_type IN ('acl','retention','automation','compliance')),
  rules       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by  TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 8. os_audit_events
CREATE TABLE IF NOT EXISTS public.os_audit_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id       UUID REFERENCES public.os_rooms(id) ON DELETE SET NULL,
  actor_merchant_id TEXT NOT NULL,
  event_type    TEXT NOT NULL,
  target_type   TEXT,
  target_id     UUID,
  metadata      JSONB DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 9. os_workflow_runs
CREATE TABLE IF NOT EXISTS public.os_workflow_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id         UUID NOT NULL REFERENCES public.os_rooms(id) ON DELETE CASCADE,
  workflow_name   TEXT NOT NULL,
  trigger_message_id UUID REFERENCES public.os_messages(id) ON DELETE SET NULL,
  status          TEXT NOT NULL DEFAULT 'running'
                    CHECK (status IN ('running','completed','failed','cancelled')),
  input_payload   JSONB DEFAULT '{}'::jsonb,
  output_payload  JSONB DEFAULT '{}'::jsonb,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ
);

-- 10. os_room_presence
CREATE TABLE IF NOT EXISTS public.os_room_presence (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id               UUID NOT NULL REFERENCES public.os_rooms(id) ON DELETE CASCADE,
  merchant_id           TEXT NOT NULL,
  is_focused            BOOLEAN NOT NULL DEFAULT false,
  last_read_message_id  UUID REFERENCES public.os_messages(id) ON DELETE SET NULL,
  last_seen_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (room_id, merchant_id)
);
