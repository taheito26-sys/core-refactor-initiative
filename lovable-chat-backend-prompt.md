# Lovable Prompt — Chat System Backend + Migration

## Context

We just rebuilt the chat frontend into a three-column workspace (Sidebar | MessageTimeline | ContextPanel) using Zustand for state, decomposed into 12 components + 3 hooks + 1 store + 1 codec. The frontend is committed and pushed. Now we need the Supabase backend to evolve to support the new architecture and migrate existing conversations.

---

## 1. Schema Migration: `merchant_messages` table

The existing `merchant_messages` table is:

```sql
CREATE TABLE public.merchant_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  relationship_id UUID NOT NULL REFERENCES public.merchant_relationships(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES auth.users(id),
  content TEXT NOT NULL,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Add these columns** via ALTER TABLE (do NOT recreate the table — existing data must survive):

```sql
ALTER TABLE public.merchant_messages
  ADD COLUMN IF NOT EXISTS msg_type TEXT NOT NULL DEFAULT 'text'
    CHECK (msg_type IN ('text','voice','poll','forward','system','image','file')),
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reply_to UUID REFERENCES public.merchant_messages(id),
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';
```

- `msg_type` — enables the frontend's `parseMsg()` codec to route rendering. Existing rows are all `'text'` (the default).
- `delivered_at` — enables ✓ (delivered) vs ✓✓ (read) status ticks in the UI.
- `edited_at` — tracks message edits; frontend shows "(edited)" label.
- `reply_to` — self-reference for reply threading; frontend renders quoted reply bubble.
- `metadata` — flexible JSON for voice duration, poll options, file URLs, forward source, etc.

**Add index for conversation loading performance:**

```sql
CREATE INDEX IF NOT EXISTS idx_messages_relationship_created
  ON public.merchant_messages (relationship_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_messages_unread
  ON public.merchant_messages (relationship_id, read_at)
  WHERE read_at IS NULL;
```

### Backfill existing messages

All existing messages in `merchant_messages` are plain text. They already have `content`, `sender_id`, `relationship_id`, `read_at`, `created_at`. The `msg_type` column defaults to `'text'` so **no data backfill is needed** — just the ALTER TABLE. Existing conversations will appear in the new three-column UI automatically since the frontend queries `merchant_messages` the same way (`SELECT ... FROM merchant_messages WHERE relationship_id IN (...) ORDER BY created_at ASC`).

---

## 2. Schema Migration: `notifications` table

The existing `notifications` table is:

```sql
CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category TEXT NOT NULL DEFAULT 'system' CHECK (category IN ('invite','approval','system','message','deal')),
  title TEXT NOT NULL,
  body TEXT,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Add deep-linking columns** (the frontend's `notification-router.ts` reads these for click-to-navigate):

```sql
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS conversation_id UUID REFERENCES public.merchant_relationships(id),
  ADD COLUMN IF NOT EXISTS message_id UUID REFERENCES public.merchant_messages(id),
  ADD COLUMN IF NOT EXISTS entity_type TEXT,
  ADD COLUMN IF NOT EXISTS entity_id TEXT,
  ADD COLUMN IF NOT EXISTS anchor_id TEXT;
```

- `conversation_id` + `message_id` — for `category = 'message'` notifications, enables clicking a notification to jump directly to that conversation and scroll to the exact message.
- `entity_type` + `entity_id` — for `category = 'deal'` / `'approval'` notifications, routes to the right tracker module (e.g., `entity_type = 'deal'`, `entity_id = '<deal-uuid>'`).
- `anchor_id` — generic anchor for scroll-to-element deep linking.

---

## 3. New table: `conversation_settings`

Per-user per-conversation preferences (mute, pin, etc.):

```sql
CREATE TABLE public.conversation_settings (
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

CREATE POLICY "Users can upsert own conversation settings"
  ON public.conversation_settings FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own conversation settings"
  ON public.conversation_settings FOR UPDATE
  USING (auth.uid() = user_id);

CREATE TRIGGER update_conversation_settings_updated_at
  BEFORE UPDATE ON public.conversation_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
```

The frontend's `ConversationSidebar` reads `is_muted` and `is_pinned` to filter and sort conversations.

---

## 4. Supabase Realtime Configuration

Enable realtime on the tables the frontend subscribes to:

```sql
-- Enable realtime for chat messages (INSERT + UPDATE events)
ALTER PUBLICATION supabase_realtime ADD TABLE public.merchant_messages;

-- Enable realtime for notifications (INSERT events)
-- (may already be enabled — only add if not present)
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
```

The frontend subscribes to:
- `merchant_messages` channel `chat-messages-rt` — listens for INSERT (new messages) and UPDATE (read receipts, edits)
- `notifications` channel `notif-badge-rt` — listens for all events to refresh badge count
- Supabase Presence channels `typing:{relationshipId}` — these are client-side only (no table needed), but ensure Realtime is enabled in the Supabase project settings

---

## 5. Database Function: Mark conversation as read (batch)

The frontend calls this when the user opens a conversation — it marks all unread messages from the counterparty as read in one go:

```sql
CREATE OR REPLACE FUNCTION public.mark_conversation_read(
  _relationship_id UUID,
  _reader_id UUID DEFAULT auth.uid()
)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.merchant_messages
  SET read_at = now()
  WHERE relationship_id = _relationship_id
    AND sender_id != _reader_id
    AND read_at IS NULL;
$$;
```

**RLS note:** This is `SECURITY DEFINER` so it bypasses RLS — the caller must be a relationship member. Add a guard:

```sql
CREATE OR REPLACE FUNCTION public.mark_conversation_read(
  _relationship_id UUID,
  _reader_id UUID DEFAULT auth.uid()
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
    AND sender_id != _reader_id
    AND read_at IS NULL;
END;
$$;
```

---

## 6. Database Function: Get unread counts per conversation

The frontend needs to initialize `unreadCounts` in the Zustand store on page load:

```sql
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
```

---

## 7. Trigger: Auto-create notification on new message

When a new message is inserted, auto-create a notification for the recipient:

```sql
CREATE OR REPLACE FUNCTION public.notify_on_new_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _recipient_user_id UUID;
  _sender_name TEXT;
  _rel RECORD;
BEGIN
  -- Find the relationship to determine the recipient
  SELECT * INTO _rel FROM public.merchant_relationships WHERE id = NEW.relationship_id;

  -- Determine which merchant is the recipient (the one who didn't send)
  IF NEW.sender_id = (SELECT user_id FROM public.merchant_profiles WHERE merchant_id = _rel.merchant_a_id) THEN
    SELECT user_id INTO _recipient_user_id FROM public.merchant_profiles WHERE merchant_id = _rel.merchant_b_id;
  ELSE
    SELECT user_id INTO _recipient_user_id FROM public.merchant_profiles WHERE merchant_id = _rel.merchant_a_id;
  END IF;

  -- Get sender display name
  SELECT COALESCE(nickname, display_name, merchant_id) INTO _sender_name
  FROM public.merchant_profiles
  WHERE user_id = NEW.sender_id;

  -- Create notification with deep-link metadata
  INSERT INTO public.notifications (user_id, category, title, body, conversation_id, message_id)
  VALUES (
    _recipient_user_id,
    'message',
    _sender_name,
    LEFT(NEW.content, 100),
    NEW.relationship_id,
    NEW.id
  );

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_on_new_message
  AFTER INSERT ON public.merchant_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_on_new_message();
```

---

## 8. Migrate old conversations

**Critical:** There are existing conversations in the `merchant_messages` table that were created with the old monolithic `UnifiedChatInbox` component. These messages use a custom `||~||` delimiter encoding for special message types (replies, forwards, polls, voice notes, edits). Examples:

```
REPLY||~||Original sender||~||Original text||~||Reply text
FORWARD||~||Forward source||~||Forward text
VOICE||~||<base64-encoded-audio>||~||duration
POLL||~||Poll question||~||Option 1||~||Option 2||~||Option 3
EDITED||~||New content
SYSTEM||~||Event description
```

**Do NOT alter or re-encode these messages.** The new frontend's `message-codec.ts` (`parseMsg()` function) already handles parsing all these formats. The existing `content` column stores the full encoded string and the frontend parses it client-side. No server-side migration of message content is needed.

What IS needed:
1. **Set `msg_type` for existing encoded messages** — run a one-time backfill so the server knows the type:

```sql
-- Backfill msg_type from content encoding prefix
UPDATE public.merchant_messages
SET msg_type = CASE
  WHEN content LIKE 'REPLY||~||%' THEN 'text'
  WHEN content LIKE 'FORWARD||~||%' THEN 'forward'
  WHEN content LIKE 'VOICE||~||%' THEN 'voice'
  WHEN content LIKE 'POLL||~||%' THEN 'poll'
  WHEN content LIKE 'EDITED||~||%' THEN 'text'
  WHEN content LIKE 'SYSTEM||~||%' THEN 'system'
  ELSE 'text'
END
WHERE msg_type = 'text';  -- Only update rows that haven't been categorized
```

2. **Set `delivered_at` for all existing messages that have `read_at`** — if it was read, it was delivered:

```sql
UPDATE public.merchant_messages
SET delivered_at = COALESCE(read_at, created_at)
WHERE delivered_at IS NULL;
```

3. **Ensure `conversation_settings` rows exist for active conversations** — so the sidebar filter works:

```sql
-- Create default settings for all existing relationship members
INSERT INTO public.conversation_settings (user_id, relationship_id)
SELECT mp.user_id, mr.id
FROM public.merchant_relationships mr
JOIN public.merchant_profiles mp
  ON mp.merchant_id = mr.merchant_a_id OR mp.merchant_id = mr.merchant_b_id
WHERE mr.status = 'active'
ON CONFLICT (user_id, relationship_id) DO NOTHING;
```

---

## 9. Update Supabase Types

After running all migrations, regenerate the Supabase TypeScript types:

```bash
npx supabase gen types typescript --project-id <project-id> > src/integrations/supabase/types.ts
```

This ensures the auto-generated types include:
- `merchant_messages.msg_type`, `delivered_at`, `edited_at`, `reply_to`, `metadata`
- `notifications.conversation_id`, `message_id`, `entity_type`, `entity_id`, `anchor_id`
- `conversation_settings` table types
- RPC function signatures for `mark_conversation_read` and `get_unread_counts`

---

## 10. Existing RLS Policies (no changes needed)

The existing RLS policies on `merchant_messages` and `notifications` are correct:

- `merchant_messages` SELECT/INSERT/UPDATE: uses `is_relationship_member(relationship_id)` — ✅ works with new columns
- `notifications` SELECT/UPDATE: uses `auth.uid() = user_id` — ✅ works with new columns

**No RLS changes needed** — the new columns are added to existing tables and the existing policies cover them.

---

## Summary of changes

| Action | Table | Type |
|--------|-------|------|
| ALTER TABLE add 5 columns | `merchant_messages` | Migration |
| ALTER TABLE add 5 columns | `notifications` | Migration |
| CREATE TABLE | `conversation_settings` | New |
| CREATE FUNCTION | `mark_conversation_read` | New |
| CREATE FUNCTION | `get_unread_counts` | New |
| CREATE FUNCTION + TRIGGER | `notify_on_new_message` | New |
| ALTER PUBLICATION | `merchant_messages`, `notifications` | Realtime |
| UPDATE backfill | `merchant_messages.msg_type` | Data migration |
| UPDATE backfill | `merchant_messages.delivered_at` | Data migration |
| INSERT backfill | `conversation_settings` defaults | Data migration |
| Regenerate | `types.ts` | TypeScript |

**Order of operations:**
1. ALTER TABLE `merchant_messages` (add columns)
2. ALTER TABLE `notifications` (add columns)
3. CREATE TABLE `conversation_settings`
4. CREATE FUNCTION `mark_conversation_read`
5. CREATE FUNCTION `get_unread_counts`
6. CREATE FUNCTION + TRIGGER `notify_on_new_message`
7. ALTER PUBLICATION (enable realtime)
8. Run backfill UPDATEs (msg_type, delivered_at, conversation_settings)
9. Regenerate TypeScript types
