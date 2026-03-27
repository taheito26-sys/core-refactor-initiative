-- =====================================================================
-- Chat Backend Migration (from lovable-chat-backend-prompt.md)
-- All additive — no drops, no recreates, existing data survives.
-- =====================================================================

-- 1. ALTER merchant_messages — add new columns
ALTER TABLE public.merchant_messages
  ADD COLUMN IF NOT EXISTS msg_type TEXT NOT NULL DEFAULT 'text'
    CHECK (msg_type IN ('text','voice','poll','forward','system','image','file')),
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reply_to UUID REFERENCES public.merchant_messages(id),
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_messages_relationship_created
  ON public.merchant_messages (relationship_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_messages_unread
  ON public.merchant_messages (relationship_id, read_at)
  WHERE read_at IS NULL;

-- 2. ALTER notifications — add deep-linking columns
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS conversation_id UUID REFERENCES public.merchant_relationships(id),
  ADD COLUMN IF NOT EXISTS message_id UUID REFERENCES public.merchant_messages(id),
  ADD COLUMN IF NOT EXISTS entity_type TEXT,
  ADD COLUMN IF NOT EXISTS entity_id TEXT,
  ADD COLUMN IF NOT EXISTS anchor_id TEXT;

-- 3. CREATE TABLE conversation_settings
CREATE TABLE IF NOT EXISTS public.conversation_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  relationship_id UUID NOT NULL REFERENCES public.merchant_relationships(id) ON DELETE CASCADE,
  is_muted BOOLEAN NOT NULL DEFAULT false,
  is_pinned BOOLEAN NOT NULL DEFAULT false,
  is_archived BOOLEAN NOT NULL DEFAULT false,
  muted_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, relationship_id)
);

ALTER TABLE public.conversation_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own conversation settings"
  ON public.conversation_settings FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own conversation settings"
  ON public.conversation_settings FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own conversation settings"
  ON public.conversation_settings FOR UPDATE
  USING (auth.uid() = user_id);

CREATE TRIGGER update_conversation_settings_updated_at
  BEFORE UPDATE ON public.conversation_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4. CREATE FUNCTION mark_conversation_read
CREATE OR REPLACE FUNCTION public.mark_conversation_read(
  _relationship_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_relationship_member(_relationship_id) THEN
    RAISE EXCEPTION 'Not a member of this relationship';
  END IF;

  UPDATE public.merchant_messages
  SET read_at = now()
  WHERE relationship_id = _relationship_id
    AND sender_id != auth.uid()
    AND read_at IS NULL;
END;
$$;

-- 5. CREATE FUNCTION get_unread_counts
CREATE OR REPLACE FUNCTION public.get_unread_counts(_user_id UUID DEFAULT auth.uid())
RETURNS TABLE (relationship_id UUID, unread_count BIGINT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT mm.relationship_id, COUNT(*) AS unread_count
  FROM public.merchant_messages mm
  JOIN public.merchant_relationships mr ON mr.id = mm.relationship_id
  WHERE mm.sender_id != _user_id
    AND mm.read_at IS NULL
    AND (
      mr.merchant_a_id = (SELECT merchant_id FROM public.merchant_profiles WHERE user_id = _user_id LIMIT 1)
      OR
      mr.merchant_b_id = (SELECT merchant_id FROM public.merchant_profiles WHERE user_id = _user_id LIMIT 1)
    )
  GROUP BY mm.relationship_id;
$$;

-- 6. Replace notify_on_new_message to include deep-link columns
CREATE OR REPLACE FUNCTION public.notify_on_new_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _rel RECORD;
  _sender_merchant_id TEXT;
  _recipient_merchant_id TEXT;
  _recipient_user_id UUID;
  _sender_name TEXT;
BEGIN
  SELECT merchant_a_id, merchant_b_id INTO _rel
  FROM public.merchant_relationships
  WHERE id = NEW.relationship_id;

  IF NOT FOUND THEN RETURN NEW; END IF;

  SELECT merchant_id INTO _sender_merchant_id
  FROM public.merchant_profiles
  WHERE user_id = NEW.sender_id LIMIT 1;

  IF _sender_merchant_id = _rel.merchant_a_id THEN
    _recipient_merchant_id := _rel.merchant_b_id;
  ELSE
    _recipient_merchant_id := _rel.merchant_a_id;
  END IF;

  SELECT user_id INTO _recipient_user_id
  FROM public.merchant_profiles
  WHERE merchant_id = _recipient_merchant_id LIMIT 1;

  SELECT COALESCE(nickname, display_name, merchant_id) INTO _sender_name
  FROM public.merchant_profiles
  WHERE user_id = NEW.sender_id LIMIT 1;

  IF _recipient_user_id IS NULL THEN RETURN NEW; END IF;

  INSERT INTO public.notifications (user_id, category, title, body, conversation_id, message_id)
  VALUES (
    _recipient_user_id,
    'message',
    COALESCE(_sender_name, 'Unknown'),
    LEFT(NEW.content, 100),
    NEW.relationship_id,
    NEW.id
  );

  RETURN NEW;
END;
$$;

-- Ensure trigger exists
DROP TRIGGER IF EXISTS trg_notify_on_new_message ON public.merchant_messages;
CREATE TRIGGER trg_notify_on_new_message
  AFTER INSERT ON public.merchant_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_on_new_message();

-- 7. Enable Realtime for merchant_messages (idempotent check)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'merchant_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.merchant_messages;
  END IF;
END;
$$;

-- 8a. Backfill msg_type from content prefix
UPDATE public.merchant_messages
SET msg_type = CASE
  WHEN content LIKE 'VOICE||~||%' THEN 'voice'
  WHEN content LIKE 'FORWARD||~||%' THEN 'forward'
  WHEN content LIKE 'POLL||~||%' THEN 'poll'
  WHEN content LIKE 'SYSTEM||~||%' THEN 'system'
  ELSE 'text'
END
WHERE msg_type = 'text';

-- 8b. Set delivered_at for existing messages
UPDATE public.merchant_messages
SET delivered_at = COALESCE(read_at, created_at)
WHERE delivered_at IS NULL;

-- 8c. Insert default conversation_settings for active relationships
INSERT INTO public.conversation_settings (user_id, relationship_id)
SELECT mp.user_id, mr.id
FROM public.merchant_relationships mr
JOIN public.merchant_profiles mp
  ON mp.merchant_id = mr.merchant_a_id OR mp.merchant_id = mr.merchant_b_id
WHERE mr.status = 'active'
ON CONFLICT (user_id, relationship_id) DO NOTHING;