-- The Lovable export contains notification rows with duplicate dedupe_key
-- values. Keep the lookup index, but remove the uniqueness constraint so the
-- live import can replay without aborting on source-data collisions.

DROP INDEX IF EXISTS public.idx_notifications_dedupe_key;

CREATE INDEX IF NOT EXISTS idx_notifications_dedupe_key
    ON public.notifications USING btree (dedupe_key)
    WHERE (dedupe_key IS NOT NULL);
