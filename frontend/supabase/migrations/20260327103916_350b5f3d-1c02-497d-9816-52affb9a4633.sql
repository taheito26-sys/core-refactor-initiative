-- Create os_rooms for each merchant_relationship that doesn't already have a corresponding room
INSERT INTO os_rooms (id, name, type, lane, retention_policy, created_at, updated_at)
SELECT 
  mr.id as id,
  COALESCE(
    (SELECT display_name FROM merchant_profiles WHERE merchant_id = 
      CASE WHEN mr.merchant_a_id = 'taheito' THEN mr.merchant_b_id ELSE mr.merchant_a_id END
    LIMIT 1),
    mr.merchant_b_id
  ) as name,
  'standard' as type,
  'Personal' as lane,
  'indefinite' as retention_policy,
  mr.created_at,
  mr.updated_at
FROM merchant_relationships mr
WHERE mr.status = 'active'
  AND NOT EXISTS (SELECT 1 FROM os_rooms r WHERE r.id = mr.id)
ON CONFLICT (id) DO NOTHING;

-- Add room members for each relationship
INSERT INTO os_room_members (room_id, merchant_id, role, joined_at)
SELECT mr.id, mr.merchant_a_id, 'member', mr.created_at
FROM merchant_relationships mr
WHERE mr.status = 'active'
  AND NOT EXISTS (
    SELECT 1 FROM os_room_members rm 
    WHERE rm.room_id = mr.id AND rm.merchant_id = mr.merchant_a_id
  )
ON CONFLICT DO NOTHING;

INSERT INTO os_room_members (room_id, merchant_id, role, joined_at)
SELECT mr.id, mr.merchant_b_id, 'member', mr.created_at
FROM merchant_relationships mr
WHERE mr.status = 'active'
  AND NOT EXISTS (
    SELECT 1 FROM os_room_members rm 
    WHERE rm.room_id = mr.id AND rm.merchant_id = mr.merchant_b_id
  )
ON CONFLICT DO NOTHING;

-- Copy merchant_messages into os_messages
INSERT INTO os_messages (id, room_id, sender_merchant_id, content, created_at, read_at)
SELECT 
  mm.id,
  mm.relationship_id as room_id,
  COALESCE(
    (SELECT merchant_id FROM merchant_profiles WHERE user_id = mm.sender_id LIMIT 1),
    'unknown'
  ) as sender_merchant_id,
  mm.content,
  mm.created_at,
  mm.read_at
FROM merchant_messages mm
WHERE NOT EXISTS (SELECT 1 FROM os_messages om WHERE om.id = mm.id)
ON CONFLICT (id) DO NOTHING;

-- Update room timestamps based on latest message
UPDATE os_rooms SET updated_at = sub.latest
FROM (
  SELECT room_id, MAX(created_at) as latest
  FROM os_messages
  GROUP BY room_id
) sub
WHERE os_rooms.id = sub.room_id AND sub.latest > os_rooms.updated_at;