-- Migration: Messaging OS Phase 2 Functional Logic (Standardized)
-- Features: Real-time Message RPCs, One-time View, 24h Expiration, Schema Parity

-- 1. Correcting Table Names and Columns based on Seed Script
CREATE TABLE IF NOT EXISTS public.os_rooms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ DEFAULT now(),
    name TEXT, -- Seed script uses 'name'
    type TEXT DEFAULT 'standard',
    lane TEXT DEFAULT 'Personal',
    order_id TEXT,
    security_policies JSONB DEFAULT '{
        "disable_forwarding": false,
        "disable_copy": false,
        "disable_export": false,
        "disable_screenshots": false,
        "watermark": false
    }'::jsonb,
    retention_policy TEXT DEFAULT 'indefinite', -- Added for parity
    last_message_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.os_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ DEFAULT now(),
    room_id UUID REFERENCES public.os_rooms(id) ON DELETE CASCADE,
    sender_merchant_id TEXT, -- Seed script uses TEXT merchant_id
    sender_id UUID, -- Internal UUID for auth match
    content TEXT, -- Seed script uses 'content' instead of 'body'
    body_json JSONB DEFAULT '{}'::jsonb,
    message_type TEXT DEFAULT 'text',
    status TEXT DEFAULT 'sent',
    permissions JSONB DEFAULT '{
        "forwardable": true,
        "exportable": true,
        "copyable": true,
        "ai_readable": true
    }'::jsonb,
    expires_at TIMESTAMPTZ,
    deleted_for_everyone_at TIMESTAMPTZ,
    reply_to_message_id UUID REFERENCES public.os_messages(id) ON DELETE SET NULL,
    client_nonce TEXT UNIQUE,
    retention_policy TEXT DEFAULT 'indefinite' -- Added for parity
);

CREATE TABLE IF NOT EXISTS public.os_room_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID REFERENCES public.os_rooms(id) ON DELETE CASCADE,
    merchant_id TEXT,
    role TEXT DEFAULT 'member',
    joined_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(room_id, merchant_id)
);

CREATE TABLE IF NOT EXISTS public.os_business_objects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID REFERENCES public.os_rooms(id) ON DELETE CASCADE,
    object_type TEXT NOT NULL,
    created_by_merchant_id TEXT,
    source_message_id UUID REFERENCES public.os_messages(id) ON DELETE SET NULL,
    payload JSONB DEFAULT '{}'::jsonb,
    status TEXT DEFAULT 'pending',
    state_snapshot_hash TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Create View: chat_room_summary_v (Required by UI)
CREATE OR REPLACE VIEW public.chat_room_summary_v AS
SELECT 
    r.id,
    r.name,
    r.type,
    r.lane,
    r.order_id,
    r.last_message_at,
    r.security_policies,
    (SELECT count(*) FROM public.os_messages m WHERE m.room_id = r.id) as message_count,
    (SELECT m.content FROM public.os_messages m WHERE m.room_id = r.id ORDER BY m.created_at DESC LIMIT 1) as last_message_content,
    (SELECT m.sender_merchant_id FROM public.os_messages m WHERE m.room_id = r.id ORDER BY m.created_at DESC LIMIT 1) as last_message_sender
FROM public.os_rooms r;

-- 3. Update RPC: fn_chat_send_message
CREATE OR REPLACE FUNCTION public.fn_chat_send_message(
    _room_id UUID,
    _body TEXT,
    _body_json JSONB DEFAULT '{}'::jsonb,
    _message_type TEXT DEFAULT 'text',
    _client_nonce TEXT DEFAULT NULL,
    _reply_to_message_id UUID DEFAULT NULL,
    _expires_at TIMESTAMPTZ DEFAULT NULL
) RETURNS public.os_messages AS $$
DECLARE
    _msg public.os_messages;
    _user_id UUID;
    _merchant_id TEXT;
BEGIN
    _user_id := auth.uid();
    -- Get merchant_id from profile
    SELECT merchant_id INTO _merchant_id FROM public.merchant_profiles WHERE user_id = _user_id LIMIT 1;
    
    INSERT INTO public.os_messages (
        room_id, sender_id, sender_merchant_id, content, body_json, message_type, client_nonce, reply_to_message_id, expires_at
    ) VALUES (
        _room_id, _user_id, _merchant_id, _body, _body_json, _message_type, _client_nonce, _reply_to_message_id, _expires_at
    )
    ON CONFLICT (client_nonce) DO UPDATE SET room_id = EXCLUDED.room_id
    RETURNING * INTO _msg;

    UPDATE public.os_rooms SET last_message_at = now() WHERE id = _room_id;
    
    RETURN _msg;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Enable Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE os_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE os_rooms;
ALTER PUBLICATION supabase_realtime ADD TABLE os_room_members;
ALTER PUBLICATION supabase_realtime ADD TABLE os_business_objects;
