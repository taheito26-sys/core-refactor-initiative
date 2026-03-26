
-- ═══════════════════════════════════════════════════════════════
-- Messaging OS: RLS + Indexes + Helper function
-- ═══════════════════════════════════════════════════════════════

-- Helper: check room membership
CREATE OR REPLACE FUNCTION public.is_os_room_member(_room_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.os_room_members
    WHERE room_id = _room_id
      AND merchant_id = public.current_merchant_id()
  )
$$;

-- ── RLS Enable ──────────────────────────────────────────────────
ALTER TABLE public.os_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.os_room_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.os_channel_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.os_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.os_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.os_business_objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.os_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.os_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.os_workflow_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.os_room_presence ENABLE ROW LEVEL SECURITY;

-- ── os_rooms ────────────────────────────────────────────────────
DROP POLICY IF EXISTS "os_rooms_select" ON public.os_rooms;
CREATE POLICY "os_rooms_select" ON public.os_rooms FOR SELECT
  USING (public.is_os_room_member(id));

DROP POLICY IF EXISTS "os_rooms_insert" ON public.os_rooms;
CREATE POLICY "os_rooms_insert" ON public.os_rooms FOR INSERT
  WITH CHECK (true);

DROP POLICY IF EXISTS "os_rooms_update" ON public.os_rooms;
CREATE POLICY "os_rooms_update" ON public.os_rooms FOR UPDATE
  USING (public.is_os_room_member(id));

-- ── os_room_members ─────────────────────────────────────────────
DROP POLICY IF EXISTS "os_room_members_select" ON public.os_room_members;
CREATE POLICY "os_room_members_select" ON public.os_room_members FOR SELECT
  USING (public.is_os_room_member(room_id));

DROP POLICY IF EXISTS "os_room_members_insert" ON public.os_room_members;
CREATE POLICY "os_room_members_insert" ON public.os_room_members FOR INSERT
  WITH CHECK (public.is_os_room_member(room_id) OR merchant_id = public.current_merchant_id());

-- ── os_channel_identities ───────────────────────────────────────
DROP POLICY IF EXISTS "os_identities_select" ON public.os_channel_identities;
CREATE POLICY "os_identities_select" ON public.os_channel_identities FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "os_identities_insert" ON public.os_channel_identities;
CREATE POLICY "os_identities_insert" ON public.os_channel_identities FOR INSERT
  WITH CHECK (merchant_id = public.current_merchant_id());

DROP POLICY IF EXISTS "os_identities_update" ON public.os_channel_identities;
CREATE POLICY "os_identities_update" ON public.os_channel_identities FOR UPDATE
  USING (merchant_id = public.current_merchant_id());

-- ── os_threads ──────────────────────────────────────────────────
DROP POLICY IF EXISTS "os_threads_select" ON public.os_threads;
CREATE POLICY "os_threads_select" ON public.os_threads FOR SELECT
  USING (public.is_os_room_member(room_id));

DROP POLICY IF EXISTS "os_threads_insert" ON public.os_threads;
CREATE POLICY "os_threads_insert" ON public.os_threads FOR INSERT
  WITH CHECK (public.is_os_room_member(room_id));

-- ── os_messages ─────────────────────────────────────────────────
DROP POLICY IF EXISTS "os_messages_select" ON public.os_messages;
CREATE POLICY "os_messages_select" ON public.os_messages FOR SELECT
  USING (public.is_os_room_member(room_id));

DROP POLICY IF EXISTS "os_messages_insert" ON public.os_messages;
CREATE POLICY "os_messages_insert" ON public.os_messages FOR INSERT
  WITH CHECK (public.is_os_room_member(room_id) AND sender_merchant_id = public.current_merchant_id());

DROP POLICY IF EXISTS "os_messages_update" ON public.os_messages;
CREATE POLICY "os_messages_update" ON public.os_messages FOR UPDATE
  USING (public.is_os_room_member(room_id));

-- ── os_business_objects ─────────────────────────────────────────
DROP POLICY IF EXISTS "os_bo_select" ON public.os_business_objects;
CREATE POLICY "os_bo_select" ON public.os_business_objects FOR SELECT
  USING (public.is_os_room_member(room_id));

DROP POLICY IF EXISTS "os_bo_insert" ON public.os_business_objects;
CREATE POLICY "os_bo_insert" ON public.os_business_objects FOR INSERT
  WITH CHECK (public.is_os_room_member(room_id));

DROP POLICY IF EXISTS "os_bo_update" ON public.os_business_objects;
CREATE POLICY "os_bo_update" ON public.os_business_objects FOR UPDATE
  USING (public.is_os_room_member(room_id));

-- ── os_policies ─────────────────────────────────────────────────
DROP POLICY IF EXISTS "os_policies_select" ON public.os_policies;
CREATE POLICY "os_policies_select" ON public.os_policies FOR SELECT
  USING (room_id IS NULL OR public.is_os_room_member(room_id));

DROP POLICY IF EXISTS "os_policies_insert" ON public.os_policies;
CREATE POLICY "os_policies_insert" ON public.os_policies FOR INSERT
  WITH CHECK (room_id IS NULL OR public.is_os_room_member(room_id));

-- ── os_audit_events ─────────────────────────────────────────────
DROP POLICY IF EXISTS "os_audit_select" ON public.os_audit_events;
CREATE POLICY "os_audit_select" ON public.os_audit_events FOR SELECT
  USING (room_id IS NULL OR public.is_os_room_member(room_id));

DROP POLICY IF EXISTS "os_audit_insert" ON public.os_audit_events;
CREATE POLICY "os_audit_insert" ON public.os_audit_events FOR INSERT
  WITH CHECK (true);

-- ── os_workflow_runs ────────────────────────────────────────────
DROP POLICY IF EXISTS "os_wf_select" ON public.os_workflow_runs;
CREATE POLICY "os_wf_select" ON public.os_workflow_runs FOR SELECT
  USING (public.is_os_room_member(room_id));

DROP POLICY IF EXISTS "os_wf_insert" ON public.os_workflow_runs;
CREATE POLICY "os_wf_insert" ON public.os_workflow_runs FOR INSERT
  WITH CHECK (public.is_os_room_member(room_id));

DROP POLICY IF EXISTS "os_wf_update" ON public.os_workflow_runs;
CREATE POLICY "os_wf_update" ON public.os_workflow_runs FOR UPDATE
  USING (public.is_os_room_member(room_id));

-- ── os_room_presence ────────────────────────────────────────────
DROP POLICY IF EXISTS "os_presence_select" ON public.os_room_presence;
CREATE POLICY "os_presence_select" ON public.os_room_presence FOR SELECT
  USING (public.is_os_room_member(room_id));

DROP POLICY IF EXISTS "os_presence_upsert" ON public.os_room_presence;
CREATE POLICY "os_presence_upsert" ON public.os_room_presence FOR INSERT
  WITH CHECK (merchant_id = public.current_merchant_id() AND public.is_os_room_member(room_id));

DROP POLICY IF EXISTS "os_presence_update" ON public.os_room_presence;
CREATE POLICY "os_presence_update" ON public.os_room_presence FOR UPDATE
  USING (merchant_id = public.current_merchant_id());

-- ── Indexes ─────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_os_room_members_room ON public.os_room_members(room_id);
CREATE INDEX IF NOT EXISTS idx_os_room_members_merchant ON public.os_room_members(merchant_id);
CREATE INDEX IF NOT EXISTS idx_os_messages_room_created ON public.os_messages(room_id, created_at);
CREATE INDEX IF NOT EXISTS idx_os_messages_unread ON public.os_messages(room_id, read_at) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_os_messages_thread ON public.os_messages(thread_id) WHERE thread_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_os_bo_room_created ON public.os_business_objects(room_id, created_at);
CREATE INDEX IF NOT EXISTS idx_os_bo_source ON public.os_business_objects(source_message_id) WHERE source_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_os_audit_room ON public.os_audit_events(room_id, created_at);
CREATE INDEX IF NOT EXISTS idx_os_audit_actor ON public.os_audit_events(actor_merchant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_os_wf_room ON public.os_workflow_runs(room_id, started_at);
CREATE INDEX IF NOT EXISTS idx_os_presence_room ON public.os_room_presence(room_id, merchant_id);
CREATE INDEX IF NOT EXISTS idx_os_threads_room ON public.os_threads(room_id);
CREATE INDEX IF NOT EXISTS idx_os_identities_merchant ON public.os_channel_identities(merchant_id);
CREATE INDEX IF NOT EXISTS idx_os_policies_room ON public.os_policies(room_id);
