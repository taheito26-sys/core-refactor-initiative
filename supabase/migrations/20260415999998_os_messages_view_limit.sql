-- Legacy OS message export field required by the data bundle.

ALTER TABLE public.os_messages
  ADD COLUMN IF NOT EXISTS view_limit integer;
