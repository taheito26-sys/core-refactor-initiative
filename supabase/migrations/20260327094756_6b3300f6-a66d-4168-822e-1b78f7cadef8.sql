
-- Create view: chat_room_summary_v (if not exists)
CREATE OR REPLACE VIEW public.chat_room_summary_v AS
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

-- Create fn_chat_send_message RPC
CREATE OR REPLACE FUNCTION public.fn_chat_send_message(
    _room_id UUID,
    _body TEXT,
    _body_json JSONB DEFAULT '{}'::jsonb,
    _message_type TEXT DEFAULT 'text',
    _client_nonce TEXT DEFAULT NULL,
    _reply_to_message_id UUID DEFAULT NULL,
    _expires_at TIMESTAMPTZ DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
    _msg_id UUID;
    _mid TEXT;
BEGIN
    _mid := public.current_merchant_id();
    IF _mid IS NULL THEN
        RAISE EXCEPTION 'No merchant profile found for current user';
    END IF;

    INSERT INTO public.os_messages (
        room_id, sender_merchant_id, content, expires_at
    ) VALUES (
        _room_id, _mid, _body, _expires_at
    )
    RETURNING id INTO _msg_id;

    UPDATE public.os_rooms SET updated_at = now() WHERE id = _room_id;

    RETURN jsonb_build_object('id', _msg_id, 'room_id', _room_id, 'content', _body, 'sender_merchant_id', _mid);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Create fn_chat_mark_read RPC
CREATE OR REPLACE FUNCTION public.fn_chat_mark_read(
    _room_id UUID,
    _message_id UUID
) RETURNS BOOLEAN AS $$
BEGIN
    UPDATE public.os_messages 
    SET read_at = now() 
    WHERE room_id = _room_id 
      AND id = _message_id 
      AND read_at IS NULL;
    
    RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
