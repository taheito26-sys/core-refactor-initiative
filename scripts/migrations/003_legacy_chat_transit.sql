-- Migration: Chat OS Data Transit (Legacy to OS)
-- Target: Porting merchant_messages to os_messages

-- 1. Transit Rooms (from merchant_relationships)
INSERT INTO public.os_rooms (id, created_at, name, type, lane)
SELECT 
    id, 
    created_at, 
    'Merchant Conversation' as name, 
    'standard' as type, 
    'Personal' as lane
FROM public.merchant_relationships
ON CONFLICT (id) DO NOTHING;

-- 2. Transit Members
-- Add Merchant A
INSERT INTO public.os_room_members (room_id, merchant_id, role)
SELECT 
    id as room_id, 
    merchant_a_id as merchant_id, 
    'member' as role
FROM public.merchant_relationships
ON CONFLICT DO NOTHING;

-- Add Merchant B
INSERT INTO public.os_room_members (room_id, merchant_id, role)
SELECT 
    id as room_id, 
    merchant_b_id as merchant_id, 
    'member' as role
FROM public.merchant_relationships
ON CONFLICT DO NOTHING;

-- 3. Transit Messages (Resolving User UUIDs)
INSERT INTO public.os_messages (
    id, 
    room_id, 
    sender_merchant_id, 
    sender_id, 
    content, 
    message_type, 
    created_at, 
    status,
    reply_to_message_id
)
SELECT 
    m.id,
    m.relationship_id as room_id,
    m.sender_id as sender_merchant_id,
    p.user_id as sender_id,
    m.content,
    m.msg_type as message_type,
    m.created_at,
    'sent' as status,
    m.reply_to as reply_to_message_id
FROM public.merchant_messages m
LEFT JOIN public.merchant_profiles p ON m.sender_id = p.merchant_id
ON CONFLICT (id) DO NOTHING;

-- 4. Update os_rooms last_message_at
UPDATE public.os_rooms r
SET last_message_at = (
    SELECT MAX(created_at) 
    FROM public.os_messages m 
    WHERE m.room_id = r.id
)
WHERE EXISTS (SELECT 1 FROM public.os_messages m WHERE m.room_id = r.id);
