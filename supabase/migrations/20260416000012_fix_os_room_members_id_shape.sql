-- The Lovable data dump inserts an `id` column into os_room_members, but the
-- live table replay still has the older composite primary-key shape. Convert it
-- to the dump-compatible shape before importing the legacy rows.

ALTER TABLE public.os_room_members
    ADD COLUMN IF NOT EXISTS id uuid;

UPDATE public.os_room_members
SET id = gen_random_uuid()
WHERE id IS NULL;

ALTER TABLE public.os_room_members
    ALTER COLUMN id SET DEFAULT gen_random_uuid();

ALTER TABLE public.os_room_members
    ALTER COLUMN id SET NOT NULL;

ALTER TABLE public.os_room_members
    DROP CONSTRAINT IF EXISTS os_room_members_pkey;

ALTER TABLE public.os_room_members
    DROP CONSTRAINT IF EXISTS os_room_members_room_id_merchant_id_key;

ALTER TABLE ONLY public.os_room_members
    ADD CONSTRAINT os_room_members_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.os_room_members
    ADD CONSTRAINT os_room_members_room_id_merchant_id_key UNIQUE (room_id, merchant_id);

CREATE INDEX IF NOT EXISTS idx_os_room_members_merchant
    ON public.os_room_members USING btree (merchant_id);

CREATE INDEX IF NOT EXISTS idx_os_room_members_room
    ON public.os_room_members USING btree (room_id);

ALTER TABLE public.os_room_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS os_room_members_insert ON public.os_room_members;
DROP POLICY IF EXISTS os_room_members_select ON public.os_room_members;

CREATE POLICY os_room_members_insert
    ON public.os_room_members
    FOR INSERT
    WITH CHECK ((public.is_os_room_member(room_id) OR (merchant_id = public.current_merchant_id())));

CREATE POLICY os_room_members_select
    ON public.os_room_members
    FOR SELECT
    USING (public.is_os_room_member(room_id));
