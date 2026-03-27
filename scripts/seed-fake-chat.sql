-- Seeding Script for Trade Immutable Room Chat
-- Run this in the Supabase SQL Editor

-- 1. Create/Identify a Mock Merchant Profile
DO $$
DECLARE
    merchant_id_val TEXT := 'M-TEST-001';
    user_id_val UUID := '00000000-0000-0000-0000-000000000000'; -- Replace with a real user UUID if needed
    room_id_val UUID;
    msg1_id_val UUID;
BEGIN
    -- Insert Mock Merchant if not exists
    INSERT INTO public.merchant_profiles (merchant_id, user_id, display_name, nickname, status)
    VALUES (merchant_id_val, user_id_val, 'Alpha Merchant', 'Alpha', 'active')
    ON CONFLICT (merchant_id) DO NOTHING;

    -- 2. Create OS Room (Deal Type)
    INSERT INTO public.os_rooms (name, type, lane, security_policies, retention_policy)
    VALUES (
        'Alpha Deal Negotiation',
        'deal',
        'Deals',
        '{"disable_forwarding": true, "disable_copy": true, "disable_export": true, "watermark": true}'::jsonb,
        'indefinite'
    )
    RETURNING id INTO room_id_val;

    -- 3. Add Merchant to Room Members
    INSERT INTO public.os_room_members (room_id, merchant_id, role)
    VALUES (room_id_val, merchant_id_val, 'owner');

    -- 4. Insert Standard Message
    INSERT INTO public.os_messages (room_id, sender_merchant_id, content, permissions, retention_policy)
    VALUES (
        room_id_val,
        merchant_id_val,
        'Hello! I''ve attached the initial deal offer for the Alpha project.',
        '{"forwardable": false, "exportable": false, "copyable": false, "ai_readable": true}'::jsonb,
        'indefinite'
    )
    RETURNING id INTO msg1_id_val;

    -- 5. Insert Pending Deal Offer Business Object
    INSERT INTO public.os_business_objects (room_id, object_type, created_by_merchant_id, source_message_id, payload, status)
    VALUES (
        room_id_val,
        'deal_offer',
        'M-TEST-001',
        msg1_id_val,
        '{"amount": 50000, "currency": "USDT", "asset": "Alpha-X", "terms": "Standard net-30 settlement."}'::jsonb,
        'pending'
    );

    -- 6. Insert Locked Agreement (Immutable Snapshot)
    INSERT INTO public.os_messages (room_id, sender_merchant_id, content, retention_policy)
    VALUES (
        room_id_val,
        merchant_id_val,
        'The previous agreement has been signed and locked.',
        'indefinite'
    );

    INSERT INTO public.os_business_objects (room_id, object_type, created_by_merchant_id, payload, status, state_snapshot_hash)
    VALUES (
        room_id_val,
        'snapshot',
        'M-TEST-001',
        '{"contract_id": "CTR-2026-A", "signed_by": ["Alpha", "Beta"], "effective_date": "2026-03-26"}'::jsonb,
        'locked',
        'sha256-bd7e305e5d3c8a9f0e1d2c3b4a5f6e7d8c9b0a1a2b3c4d5e6f7a8b9c0d1e2f3g'
    );

    RAISE NOTICE 'Seeding completed for Room: %', room_id_val;
END $$;
