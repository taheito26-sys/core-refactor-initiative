-- Legacy OS presence table required by the Lovable data dump.

CREATE TABLE IF NOT EXISTS public.os_room_presence (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    room_id uuid NOT NULL,
    merchant_id text NOT NULL,
    is_focused boolean DEFAULT false NOT NULL,
    last_read_message_id uuid,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.os_room_presence
    DROP CONSTRAINT IF EXISTS os_room_presence_pkey;

ALTER TABLE ONLY public.os_room_presence
    DROP CONSTRAINT IF EXISTS os_room_presence_room_id_merchant_id_key;

ALTER TABLE ONLY public.os_room_presence
    ADD CONSTRAINT os_room_presence_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.os_room_presence
    ADD CONSTRAINT os_room_presence_room_id_merchant_id_key UNIQUE (room_id, merchant_id);

CREATE INDEX IF NOT EXISTS idx_os_presence_room
    ON public.os_room_presence USING btree (room_id, merchant_id);

ALTER TABLE ONLY public.os_room_presence
    DROP CONSTRAINT IF EXISTS os_room_presence_last_read_message_id_fkey;

ALTER TABLE ONLY public.os_room_presence
    DROP CONSTRAINT IF EXISTS os_room_presence_room_id_fkey;

ALTER TABLE ONLY public.os_room_presence
    ADD CONSTRAINT os_room_presence_last_read_message_id_fkey
    FOREIGN KEY (last_read_message_id) REFERENCES public.os_messages(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.os_room_presence
    ADD CONSTRAINT os_room_presence_room_id_fkey
    FOREIGN KEY (room_id) REFERENCES public.os_rooms(id) ON DELETE CASCADE;

ALTER TABLE public.os_room_presence ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS os_presence_select ON public.os_room_presence;
DROP POLICY IF EXISTS os_presence_update ON public.os_room_presence;
DROP POLICY IF EXISTS os_presence_upsert ON public.os_room_presence;

CREATE POLICY os_presence_select
    ON public.os_room_presence
    FOR SELECT
    USING (public.is_os_room_member(room_id));

CREATE POLICY os_presence_update
    ON public.os_room_presence
    FOR UPDATE
    USING ((merchant_id = public.current_merchant_id()));

CREATE POLICY os_presence_upsert
    ON public.os_room_presence
    FOR INSERT
    WITH CHECK (((merchant_id = public.current_merchant_id()) AND public.is_os_room_member(room_id)));
