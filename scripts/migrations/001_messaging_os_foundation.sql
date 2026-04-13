-- 1. Create Rooms Table
CREATE TABLE public.os_rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'standard', -- standard, deal, broadcast
  lane TEXT NOT NULL DEFAULT 'Personal', -- Personal, Team, Customers, Deals
  security_policies JSONB DEFAULT '{"disable_forwarding": false, "disable_copy": false, "disable_export": false, "watermark": true}',
  retention_policy TEXT DEFAULT 'indefinite',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Create Room Members Table
CREATE TABLE public.os_room_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID REFERENCES public.os_rooms(id) ON DELETE CASCADE,
  merchant_id TEXT NOT NULL, -- References merchant_profiles.merchant_id
  role TEXT DEFAULT 'member', -- owner, admin, member
  joined_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(room_id, merchant_id)
);

-- 3. Create Rich Messages Table
CREATE TABLE public.os_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID REFERENCES public.os_rooms(id) ON DELETE CASCADE,
  sender_merchant_id TEXT NOT NULL,
  sender_identity_id UUID, -- For omnichannel
  content TEXT NOT NULL,
  permissions JSONB DEFAULT '{"forwardable": true, "exportable": true, "copyable": true, "ai_readable": true}',
  read_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  retention_policy TEXT DEFAULT 'indefinite',
  view_limit INT,
  thread_id UUID,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 4. Migrate Legacy Relationships to Rooms
INSERT INTO public.os_rooms (id, name, type, lane)
SELECT id, 'Direct Message', 'standard', 'Personal'
FROM public.merchant_relationships;

-- 5. Migrate Legacy Members
INSERT INTO public.os_room_members (room_id, merchant_id, role)
SELECT id, merchant_a_id, 'owner' FROM public.merchant_relationships
UNION ALL
SELECT id, merchant_b_id, 'member' FROM public.merchant_relationships;

-- 6. Migrate Legacy Messages
INSERT INTO public.os_messages (id, room_id, sender_merchant_id, content, read_at, created_at)
SELECT 
  m.id, 
  m.relationship_id, 
  p.merchant_id, 
  m.content, 
  m.read_at, 
  m.created_at
FROM public.merchant_messages m
JOIN public.merchant_profiles p ON p.user_id = m.sender_id;