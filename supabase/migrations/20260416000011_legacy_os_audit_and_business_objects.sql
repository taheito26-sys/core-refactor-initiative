-- Legacy OS compatibility tables required by the Lovable export bundle.
-- These tables exist in the source dump but were not part of the repo-managed
-- migration history, so the fresh project needs them before replaying live data.

CREATE TABLE IF NOT EXISTS public.os_audit_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    room_id uuid,
    actor_merchant_id text NOT NULL,
    event_type text NOT NULL,
    target_type text,
    target_id uuid,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.os_business_objects (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    room_id uuid NOT NULL,
    object_type text NOT NULL,
    source_message_id uuid,
    created_by_merchant_id text NOT NULL,
    state_snapshot_hash text,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT os_business_objects_object_type_check CHECK (
        object_type = ANY (ARRAY[
            'order'::text,
            'payment'::text,
            'agreement'::text,
            'dispute'::text,
            'task'::text,
            'deal_offer'::text,
            'snapshot'::text
        ])
    ),
    CONSTRAINT os_business_objects_status_check CHECK (
        status = ANY (ARRAY[
            'pending'::text,
            'accepted'::text,
            'rejected'::text,
            'completed'::text,
            'locked'::text
        ])
    )
);

ALTER TABLE ONLY public.os_audit_events
    DROP CONSTRAINT IF EXISTS os_audit_events_pkey;

ALTER TABLE ONLY public.os_business_objects
    DROP CONSTRAINT IF EXISTS os_business_objects_pkey;

ALTER TABLE ONLY public.os_audit_events
    ADD CONSTRAINT os_audit_events_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.os_business_objects
    ADD CONSTRAINT os_business_objects_pkey PRIMARY KEY (id);

CREATE INDEX IF NOT EXISTS idx_os_audit_actor
    ON public.os_audit_events USING btree (actor_merchant_id, created_at);

CREATE INDEX IF NOT EXISTS idx_os_audit_room
    ON public.os_audit_events USING btree (room_id, created_at);

CREATE INDEX IF NOT EXISTS idx_os_bo_room_created
    ON public.os_business_objects USING btree (room_id, created_at);

CREATE INDEX IF NOT EXISTS idx_os_bo_source
    ON public.os_business_objects USING btree (source_message_id)
    WHERE (source_message_id IS NOT NULL);

ALTER TABLE ONLY public.os_audit_events
    DROP CONSTRAINT IF EXISTS os_audit_events_room_id_fkey;

ALTER TABLE ONLY public.os_business_objects
    DROP CONSTRAINT IF EXISTS os_business_objects_room_id_fkey;

ALTER TABLE ONLY public.os_business_objects
    DROP CONSTRAINT IF EXISTS os_business_objects_source_message_id_fkey;

ALTER TABLE ONLY public.os_audit_events
    ADD CONSTRAINT os_audit_events_room_id_fkey
    FOREIGN KEY (room_id) REFERENCES public.os_rooms(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.os_business_objects
    ADD CONSTRAINT os_business_objects_room_id_fkey
    FOREIGN KEY (room_id) REFERENCES public.os_rooms(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.os_business_objects
    ADD CONSTRAINT os_business_objects_source_message_id_fkey
    FOREIGN KEY (source_message_id) REFERENCES public.os_messages(id) ON DELETE SET NULL;

ALTER TABLE public.os_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.os_business_objects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS os_audit_insert ON public.os_audit_events;
DROP POLICY IF EXISTS os_audit_select ON public.os_audit_events;
DROP POLICY IF EXISTS os_bo_insert ON public.os_business_objects;
DROP POLICY IF EXISTS os_bo_select ON public.os_business_objects;
DROP POLICY IF EXISTS os_bo_update ON public.os_business_objects;

CREATE POLICY os_audit_insert
    ON public.os_audit_events
    FOR INSERT
    WITH CHECK ((actor_merchant_id = public.current_merchant_id()));

CREATE POLICY os_audit_select
    ON public.os_audit_events
    FOR SELECT
    USING (
        (
            (room_id IS NOT NULL AND public.is_os_room_member(room_id))
            OR (room_id IS NULL AND public.has_role(auth.uid(), 'admin'::public.app_role))
        )
    );

CREATE POLICY os_bo_insert
    ON public.os_business_objects
    FOR INSERT
    WITH CHECK (public.is_os_room_member(room_id));

CREATE POLICY os_bo_select
    ON public.os_business_objects
    FOR SELECT
    USING (public.is_os_room_member(room_id));

CREATE POLICY os_bo_update
    ON public.os_business_objects
    FOR UPDATE
    USING (public.is_os_room_member(room_id));
