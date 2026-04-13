-- Comprehensive Messaging OS Seeding v2
-- Lanes: Personal, Team, Customers, Deals, Alerts, Archived
-- Features: Security Policies, Operational Badges, Identity Stitching, Omnichannel

-- 1. Setup Identities (Dummy Senders)
INSERT INTO os_channel_identities (id, provider_type, provider_user_id, display_name)
VALUES 
  ('ident-wa-1', 'whatsapp', '+97400010001', 'Khalid Al-Hajri (WA)'),
  ('ident-wa-2', 'whatsapp', '+97400010002', 'Sara (WA Support)'),
  ('ident-sms-1', 'sms', '+97400020002', 'Ahmed (SMS)'),
  ('ident-mail-1', 'email', 'jassim@example.qa', 'Jassim Al-Thani (Email)'),
  ('ident-tg-1', 'telegram', 'fatima_qa', 'Fatima (Telegram)'),
  ('ident-mx-1', 'matrix', '@abdullah:matrix.org', 'Abdullah (Matrix)')
ON CONFLICT (id) DO NOTHING;

-- 2. Setup Rooms for all Lanes
INSERT INTO os_rooms (id, name, lane, type, security_policies)
VALUES 
  ('room-personal-1', 'Family Weekend', 'Personal', 'standard', '{"watermark": false}'),
  ('room-team-1', 'DevOps & Infrastructure', 'Team', 'standard', '{"watermark": false}'),
  ('room-customer-1', 'Enterprise Quote #A102', 'Customers', 'standard', '{"watermark": true}'),
  ('room-deal-1', 'Project Falcon Acquisition', 'Deals', 'deal', '{"watermark": true, "disable_copy": true, "disable_forward": true}'),
  ('room-alert-1', 'SECURITY ALERTS: CORE', 'Alerts', 'incident', '{"watermark": false}'),
  ('room-archive-1', 'Q4 2025 Financial Summary', 'Archived', 'standard', '{"watermark": false}')
ON CONFLICT (id) DO NOTHING;

-- 3. Setup Members
INSERT INTO os_room_members (room_id, merchant_id, role)
VALUES 
  ('room-personal-1', 'user-me-123', 'owner'),
  ('room-team-1', 'user-me-123', 'admin'),
  ('room-customer-1', 'user-me-123', 'owner'),
  ('room-deal-1', 'user-me-123', 'admin'),
  ('room-alert-1', 'user-me-123', 'member'),
  ('room-archive-1', 'user-me-123', 'owner')
ON CONFLICT DO NOTHING;

-- 4. Seed Messages with Diverse Identities & Permissions
INSERT INTO os_messages (id, room_id, sender_merchant_id, sender_identity_id, content, permissions, status)
VALUES 
  -- Personal (WhatsApp)
  ('msg-p1', 'room-personal-1', 'user-extern-1', 'ident-wa-1', 'Did you see the latest crypto rates?', '{"forwardable": true, "copyable": true}', 'read'),
  ('msg-p2', 'room-personal-1', 'user-me-123', NULL, 'Not yet, let me check the dashboard.', '{"forwardable": true, "copyable": true}', 'sent'),
  
  -- Team (Email & Telegram)
  ('msg-t1', 'room-team-1', 'user-extern-2', 'ident-mail-1', 'Attached the architecture diagram for the new gateway.', '{"forwardable": true, "copyable": true}', 'read'),
  ('msg-t2', 'room-team-1', 'user-extern-4', 'ident-tg-1', 'I am seeing some lag in the dev environment.', '{"forwardable": true, "copyable": true}', 'read'),
  
  -- Customers (WhatsApp)
  ('msg-c1', 'room-customer-1', 'user-extern-4', 'ident-wa-2', 'We need to upgrade our plan by next week.', '{"forwardable": true, "copyable": true}', 'read'),
  ('msg-c2', 'room-customer-1', 'user-me-123', NULL, 'I will transition this to the Deals lane for negotiation.', '{"forwardable": true, "copyable": true}', 'sent'),

  -- Deals (RESTRICTED - Email)
  ('msg-d1', 'room-deal-1', 'user-extern-3', 'ident-mail-1', 'CONFIDENTIAL: Our counter-offer is 2.5% equity + $100k cash.', '{"forwardable": false, "copyable": false}', 'read'),
  ('msg-d2', 'room-deal-1', 'user-me-123', NULL, 'Received. Running the numbers through the risk engine.', '{"forwardable": false, "copyable": false}', 'sent'),

  -- Alerts (System)
  ('msg-a1', 'room-alert-1', 'system', NULL, 'ALERT: Unauthorized access attempt detected on NODE-04.', '{"forwardable": true, "copyable": true}', 'read'),
  ('msg-a2', 'room-alert-1', 'user-me-123', NULL, 'Acknowledge. Throttling connections now.', '{"forwardable": true, "copyable": true}', 'sent')
ON CONFLICT (id) DO NOTHING;

-- 5. Seed Business Objects (Deals & Snapshots)
INSERT INTO os_business_objects (id, room_id, object_type, payload, status, created_by)
VALUES 
  ('obj-deal-1', 'room-deal-1', 'deal_offer', '{"amount": 100000, "equity": "2.5%", "terms": "Exclusivity for 6 months"}', 'pending', 'user-extern-3'),
  ('obj-snap-1', 'room-deal-1', 'snapshot', '{"hash": "sha256-4f8e...", "timestamp": "2026-03-26T21:00:00Z", "type": "IMMUTABLE_AGREEMENT"}', 'locked', 'system')
ON CONFLICT (id) DO NOTHING;
