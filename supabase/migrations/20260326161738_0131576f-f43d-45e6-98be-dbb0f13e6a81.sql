
-- ═══════════════════════════════════════════════════════════════
-- Messaging OS: Seed Data (idempotent)
-- ═══════════════════════════════════════════════════════════════

-- Seed rooms (only if absent)
INSERT INTO public.os_rooms (id, name, type, lane, security_policies, retention_policy)
VALUES
  ('a0000000-0000-0000-0000-000000000001'::uuid, 'Secure Deal Room', 'deal', 'Deals',
   '{"disable_forwarding":true,"disable_copy":true,"disable_export":true,"watermark":true}'::jsonb, '30d'),
  ('a0000000-0000-0000-0000-000000000002'::uuid, 'Support Channel', 'standard', 'Customers',
   '{"disable_forwarding":false,"disable_copy":false,"disable_export":false,"watermark":false}'::jsonb, 'indefinite')
ON CONFLICT (id) DO NOTHING;

-- Seed room members from first two merchants (if any exist)
INSERT INTO public.os_room_members (room_id, merchant_id, role)
SELECT 'a0000000-0000-0000-0000-000000000001'::uuid, mp.merchant_id, 
  CASE WHEN row_number() OVER (ORDER BY mp.created_at) = 1 THEN 'owner' ELSE 'member' END
FROM public.merchant_profiles mp
ORDER BY mp.created_at LIMIT 2
ON CONFLICT (room_id, merchant_id) DO NOTHING;

INSERT INTO public.os_room_members (room_id, merchant_id, role)
SELECT 'a0000000-0000-0000-0000-000000000002'::uuid, mp.merchant_id, 
  CASE WHEN row_number() OVER (ORDER BY mp.created_at) = 1 THEN 'owner' ELSE 'member' END
FROM public.merchant_profiles mp
ORDER BY mp.created_at LIMIT 2
ON CONFLICT (room_id, merchant_id) DO NOTHING;

-- Seed channel identities for first merchant
INSERT INTO public.os_channel_identities (merchant_id, provider_type, provider_uid, confidence_level)
SELECT mp.merchant_id, p.provider_type, p.provider_uid, 'certain'
FROM (SELECT merchant_id FROM public.merchant_profiles ORDER BY created_at LIMIT 1) mp
CROSS JOIN (VALUES ('Web', 'web-default'), ('WhatsApp', '+1234567890'), ('SMS', '+1234567890')) AS p(provider_type, provider_uid)
WHERE mp.merchant_id IS NOT NULL
ON CONFLICT (merchant_id, provider_type, provider_uid) DO NOTHING;

-- Seed sample messages in deal room (only if room has no messages yet)
INSERT INTO public.os_messages (room_id, sender_merchant_id, content, permissions, retention_policy)
SELECT 'a0000000-0000-0000-0000-000000000001'::uuid, mp.merchant_id,
  'Welcome to the secure deal room. All messages here are watermarked and cannot be forwarded.',
  '{"forwardable":false,"exportable":false,"copyable":false,"ai_readable":true}'::jsonb, '30d'
FROM (SELECT merchant_id FROM public.merchant_profiles ORDER BY created_at LIMIT 1) mp
WHERE NOT EXISTS (SELECT 1 FROM public.os_messages WHERE room_id = 'a0000000-0000-0000-0000-000000000001'::uuid);

-- Seed sample deal_offer business object
INSERT INTO public.os_business_objects (room_id, object_type, created_by_merchant_id, payload, status)
SELECT 'a0000000-0000-0000-0000-000000000001'::uuid, 'deal_offer', mp.merchant_id,
  '{"title":"Q1 Supply Agreement","amount":50000,"currency":"USDT","terms":"Net-30"}'::jsonb, 'pending'
FROM (SELECT merchant_id FROM public.merchant_profiles ORDER BY created_at LIMIT 1) mp
WHERE NOT EXISTS (SELECT 1 FROM public.os_business_objects WHERE room_id = 'a0000000-0000-0000-0000-000000000001'::uuid AND object_type = 'deal_offer');
