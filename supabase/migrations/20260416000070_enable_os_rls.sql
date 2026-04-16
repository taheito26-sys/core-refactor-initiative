-- Final hardening for the legacy OS chat tables.
-- The cutover data is in place; this migration turns on RLS and applies the
-- same room-membership model already used by the newer chat policy set.

ALTER TABLE public.os_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.os_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.os_channel_identities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS os_rooms_select ON public.os_rooms;
DROP POLICY IF EXISTS os_rooms_insert ON public.os_rooms;
DROP POLICY IF EXISTS os_rooms_update ON public.os_rooms;
DROP POLICY IF EXISTS os_rooms_delete ON public.os_rooms;
DROP POLICY IF EXISTS os_messages_select ON public.os_messages;
DROP POLICY IF EXISTS os_messages_insert ON public.os_messages;
DROP POLICY IF EXISTS os_messages_update ON public.os_messages;
DROP POLICY IF EXISTS os_messages_delete ON public.os_messages;
DROP POLICY IF EXISTS os_channel_identities_select ON public.os_channel_identities;
DROP POLICY IF EXISTS os_channel_identities_insert ON public.os_channel_identities;
DROP POLICY IF EXISTS os_channel_identities_update ON public.os_channel_identities;
DROP POLICY IF EXISTS os_channel_identities_delete ON public.os_channel_identities;

CREATE POLICY os_rooms_select
  ON public.os_rooms
  FOR SELECT
  TO authenticated
  USING (
    public.is_os_room_member(id)
    OR public.has_role(auth.uid(), 'admin')
  );

CREATE POLICY os_rooms_insert
  ON public.os_rooms
  FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY os_rooms_update
  ON public.os_rooms
  FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY os_rooms_delete
  ON public.os_rooms
  FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY os_messages_select
  ON public.os_messages
  FOR SELECT
  TO authenticated
  USING (
    public.is_os_room_member(room_id)
    OR public.has_role(auth.uid(), 'admin')
  );

CREATE POLICY os_messages_insert
  ON public.os_messages
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_os_room_member(room_id)
    AND sender_merchant_id = public.current_merchant_id()
  );

CREATE POLICY os_messages_update
  ON public.os_messages
  FOR UPDATE
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR (
      public.is_os_room_member(room_id)
      AND sender_merchant_id = public.current_merchant_id()
    )
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR (
      public.is_os_room_member(room_id)
      AND sender_merchant_id = public.current_merchant_id()
    )
  );

CREATE POLICY os_messages_delete
  ON public.os_messages
  FOR DELETE
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR (
      public.is_os_room_member(room_id)
      AND sender_merchant_id = public.current_merchant_id()
    )
  );

CREATE POLICY os_channel_identities_select
  ON public.os_channel_identities
  FOR SELECT
  TO authenticated
  USING (
    merchant_id = public.current_merchant_id()
    OR public.has_role(auth.uid(), 'admin')
  );

CREATE POLICY os_channel_identities_insert
  ON public.os_channel_identities
  FOR INSERT
  TO authenticated
  WITH CHECK (
    merchant_id = public.current_merchant_id()
    OR public.has_role(auth.uid(), 'admin')
  );

CREATE POLICY os_channel_identities_update
  ON public.os_channel_identities
  FOR UPDATE
  TO authenticated
  USING (
    merchant_id = public.current_merchant_id()
    OR public.has_role(auth.uid(), 'admin')
  )
  WITH CHECK (
    merchant_id = public.current_merchant_id()
    OR public.has_role(auth.uid(), 'admin')
  );

CREATE POLICY os_channel_identities_delete
  ON public.os_channel_identities
  FOR DELETE
  TO authenticated
  USING (
    merchant_id = public.current_merchant_id()
    OR public.has_role(auth.uid(), 'admin')
  );
