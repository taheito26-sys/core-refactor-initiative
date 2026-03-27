-- Migration: Messaging OS Phase 1 Foundation
-- Features: Operational Group Types, Message-Level Permissions, Secure Rooms, Split Inbox

-- 1. Extend os_rooms with operational types and security policies
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='os_rooms' AND column_name='type') THEN
        ALTER TABLE os_rooms ADD COLUMN type TEXT DEFAULT 'standard' CHECK (type IN ('standard', 'broadcast', 'approval', 'incident', 'deal', 'temporary'));
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='os_rooms' AND column_name='security_policies') THEN
        ALTER TABLE os_rooms ADD COLUMN security_policies JSONB DEFAULT '{
            "disable_forwarding": false,
            "disable_copy": false,
            "disable_export": false,
            "disable_screenshots": false,
            "watermark": false
        }'::jsonb;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='os_rooms' AND column_name='lane') THEN
        ALTER TABLE os_rooms ADD COLUMN lane TEXT DEFAULT 'Personal' CHECK (lane IN ('Personal', 'Team', 'Customers', 'Deals', 'Alerts', 'Archived'));
    END IF;
END $$;

-- 2. Extend os_messages with per-message permissions and expiration
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='os_messages' AND column_name='permissions') THEN
        ALTER TABLE os_messages ADD COLUMN permissions JSONB DEFAULT '{
            "forwardable": true,
            "exportable": true,
            "copyable": true,
            "ai_readable": true
        }'::jsonb;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='os_messages' AND column_name='expires_at') THEN
        ALTER TABLE os_messages ADD COLUMN expires_at TIMESTAMPTZ;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='os_messages' AND column_name='retention_policy') THEN
        ALTER TABLE os_messages ADD COLUMN retention_policy TEXT;
    END IF;
END $$;
