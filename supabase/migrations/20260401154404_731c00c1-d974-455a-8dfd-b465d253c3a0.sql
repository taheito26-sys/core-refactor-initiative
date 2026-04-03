-- Remove the duplicate legacy message notification trigger that lacks precise routing fields.
-- The newer trigger 'trg_notify_on_new_message' (using notify_on_new_message) already handles
-- message notifications with actor_id, target_path, etc.
DROP TRIGGER IF EXISTS trg_notify_merchant_message ON public.merchant_messages;
DROP FUNCTION IF EXISTS public.notify_merchant_message();