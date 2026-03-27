
-- Fix: Recreate view without SECURITY DEFINER (use SECURITY INVOKER instead)
DROP VIEW IF EXISTS public.chat_room_summary_v;
CREATE VIEW public.chat_room_summary_v WITH (security_invoker = true) AS
SELECT 
    r.id,
    r.name,
    r.type,
    r.lane,
    r.updated_at as last_message_at,
    r.security_policies,
    r.retention_policy,
    (SELECT count(*) FROM public.os_messages m WHERE m.room_id = r.id) as message_count,
    (SELECT m.content FROM public.os_messages m WHERE m.room_id = r.id ORDER BY m.created_at DESC LIMIT 1) as last_message_content,
    (SELECT m.sender_merchant_id FROM public.os_messages m WHERE m.room_id = r.id ORDER BY m.created_at DESC LIMIT 1) as last_message_sender
FROM public.os_rooms r;
