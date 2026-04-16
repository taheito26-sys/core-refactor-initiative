-- This migration restores the historical version that added sender_id support
-- to os_messages on the old project. The current foundation migration already
-- includes sender_id, so this file is intentionally idempotent.

ALTER TABLE public.os_messages
  ADD COLUMN IF NOT EXISTS sender_id UUID;

