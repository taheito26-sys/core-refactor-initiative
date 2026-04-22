-- ============================================================
-- Add mirror status tracking for customer order mirroring
-- ============================================================
-- Adds:
--   1. mirror_status column on customer_orders
--   2. mirror_error_reason column for debugging failed mirrors
--   3. Index on mirror_status for query optimization
-- ============================================================

-- Add mirror_status column (pending | mirrored | skipped_not_connected | failed)
ALTER TABLE public.customer_orders
  ADD COLUMN IF NOT EXISTS mirror_status text DEFAULT 'pending'
    CHECK (mirror_status IN ('pending', 'mirrored', 'skipped_not_connected', 'failed'));

-- Add error reason for failed mirrors (for debugging)
ALTER TABLE public.customer_orders
  ADD COLUMN IF NOT EXISTS mirror_error_reason text;

-- Add index for querying pending mirrors
CREATE INDEX IF NOT EXISTS idx_customer_orders_mirror_status
  ON public.customer_orders(mirror_status)
  WHERE mirror_status IN ('pending', 'failed');

-- Comment explaining the new columns
COMMENT ON COLUMN public.customer_orders.mirror_status IS
  'Tracks whether this order was mirrored from merchant trades: pending (not yet attempted), mirrored (successfully synced), skipped_not_connected (buyer not a connected customer), failed (error during sync)';

COMMENT ON COLUMN public.customer_orders.mirror_error_reason IS
  'If mirror_status = failed, contains the error message for debugging and retry decisions';

-- Notify PostgREST to reload schema cache
NOTIFY pgrst, 'reload schema';
