
-- TASK 1: Create message_reactions table
CREATE TABLE IF NOT EXISTS public.message_reactions (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id     uuid        NOT NULL REFERENCES public.os_rooms(id) ON DELETE CASCADE,
  message_id  uuid        NOT NULL REFERENCES public.os_messages(id) ON DELETE CASCADE,
  user_id     text        NOT NULL,
  reaction    text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id, user_id, reaction)
);

ALTER TABLE public.message_reactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mr_select" ON public.message_reactions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.os_room_members
      WHERE room_id = message_reactions.room_id
        AND merchant_id = public.current_merchant_id()
    )
  );

CREATE POLICY "mr_insert" ON public.message_reactions
  FOR INSERT WITH CHECK (
    user_id = public.current_merchant_id()
    AND EXISTS (
      SELECT 1 FROM public.os_room_members
      WHERE room_id = message_reactions.room_id
        AND merchant_id = public.current_merchant_id()
    )
  );

CREATE POLICY "mr_delete" ON public.message_reactions
  FOR DELETE USING (user_id = public.current_merchant_id());

CREATE INDEX IF NOT EXISTS idx_message_reactions_message_id
  ON public.message_reactions (message_id);

CREATE INDEX IF NOT EXISTS idx_message_reactions_room_id
  ON public.message_reactions (room_id);

-- TASK 2: fn_chat_add_reaction
CREATE OR REPLACE FUNCTION public.fn_chat_add_reaction(
  _room_id    uuid,
  _message_id uuid,
  _reaction   text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_os_room_member(_room_id) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  INSERT INTO public.message_reactions
    (room_id, message_id, user_id, reaction)
  VALUES
    (_room_id, _message_id, public.current_merchant_id(), _reaction)
  ON CONFLICT (message_id, user_id, reaction) DO NOTHING;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_chat_add_reaction(uuid, uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.fn_chat_add_reaction(uuid, uuid, text) TO authenticated;

-- TASK 3: fn_chat_remove_reaction
CREATE OR REPLACE FUNCTION public.fn_chat_remove_reaction(
  _room_id    uuid,
  _message_id uuid,
  _reaction   text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.message_reactions
  WHERE message_id = _message_id
    AND user_id    = public.current_merchant_id()
    AND reaction   = _reaction;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_chat_remove_reaction(uuid, uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.fn_chat_remove_reaction(uuid, uuid, text) TO authenticated;

-- TASK 6: Enable realtime on message_reactions (os_messages already added)
ALTER PUBLICATION supabase_realtime ADD TABLE public.message_reactions;
