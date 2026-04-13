-- TASK 4: Add delete columns to os_messages
ALTER TABLE public.os_messages
  ADD COLUMN IF NOT EXISTS is_deleted  boolean      NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS deleted_at  timestamptz  DEFAULT NULL;

-- TASK 5: Add pin columns to os_messages
ALTER TABLE public.os_messages
  ADD COLUMN IF NOT EXISTS is_pinned  boolean      NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pinned_at  timestamptz  DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS pinned_by  text         DEFAULT NULL;

-- TASK 4: fn_chat_delete_message
CREATE OR REPLACE FUNCTION public.fn_chat_delete_message(
  p_room_id    uuid,
  p_message_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.os_messages
    WHERE id = p_message_id
      AND room_id = p_room_id
      AND sender_merchant_id = public.current_merchant_id()
  ) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  UPDATE public.os_messages
  SET content    = '||DELETED||',
      is_deleted = true,
      deleted_at = now()
  WHERE id = p_message_id
    AND room_id = p_room_id;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_chat_delete_message(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.fn_chat_delete_message(uuid, uuid) TO authenticated;

-- TASK 5: fn_chat_pin_message
CREATE OR REPLACE FUNCTION public.fn_chat_pin_message(
  p_room_id    uuid,
  p_message_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_os_room_member(p_room_id) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  UPDATE public.os_messages
  SET is_pinned = true,
      pinned_at = now(),
      pinned_by = public.current_merchant_id()
  WHERE id = p_message_id
    AND room_id = p_room_id;
END;
$$;

-- TASK 5: fn_chat_unpin_message
CREATE OR REPLACE FUNCTION public.fn_chat_unpin_message(
  p_room_id    uuid,
  p_message_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_os_room_member(p_room_id) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  UPDATE public.os_messages
  SET is_pinned = false,
      pinned_at = null,
      pinned_by = null
  WHERE id = p_message_id
    AND room_id = p_room_id;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_chat_pin_message(uuid, uuid) FROM public;
REVOKE ALL ON FUNCTION public.fn_chat_unpin_message(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.fn_chat_pin_message(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_chat_unpin_message(uuid, uuid) TO authenticated;