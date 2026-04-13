
-- Drop the old 9-param overload; the new 10-param version (with _attachment_id default null) covers all cases
DROP FUNCTION IF EXISTS public.chat_send_message(uuid, text, text, jsonb, uuid, text, timestamptz, boolean, text);
