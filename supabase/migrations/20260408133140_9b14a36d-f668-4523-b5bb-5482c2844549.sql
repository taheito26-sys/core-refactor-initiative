
-- 1. Add missing columns to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS full_name TEXT,
  ADD COLUMN IF NOT EXISTS username TEXT,
  ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- 2. Add missing column to merchant_profiles
ALTER TABLE public.merchant_profiles
  ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- 3. Add dedupe_key to notifications
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS dedupe_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_dedupe_key
  ON public.notifications(dedupe_key)
  WHERE dedupe_key IS NOT NULL;

-- 4. Drop FKs that will conflict with new chat tables
ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_conversation_id_fkey;

ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_message_id_fkey;

-- 5. Update category check to allow 'chat' category
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_category_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_category_check
  CHECK (category = ANY (ARRAY[
    'invite','approval','system','message','deal','stock',
    'customer_order','customer_message','order','agreement','settlement','chat'
  ]));

-- 6. Populate full_name from email for existing profiles
UPDATE public.profiles
SET full_name = COALESCE(full_name, split_part(email, '@', 1))
WHERE full_name IS NULL;
