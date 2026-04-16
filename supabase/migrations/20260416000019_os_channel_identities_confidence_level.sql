-- Compatibility shim for the legacy OS channel identity export.

ALTER TABLE public.os_channel_identities
  ADD COLUMN IF NOT EXISTS confidence_level text;

ALTER TABLE public.os_messages
  ADD COLUMN IF NOT EXISTS thread_id uuid;
