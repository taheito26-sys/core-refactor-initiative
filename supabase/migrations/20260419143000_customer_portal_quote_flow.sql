-- Customer portal quote-flow schema expansion.
-- Backward-compatible additions only.

ALTER TABLE public.customer_orders
  ADD COLUMN IF NOT EXISTS pricing_mode text NOT NULL DEFAULT 'merchant_quote',
  ADD COLUMN IF NOT EXISTS guide_rate numeric,
  ADD COLUMN IF NOT EXISTS guide_total numeric,
  ADD COLUMN IF NOT EXISTS guide_source text,
  ADD COLUMN IF NOT EXISTS guide_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS guide_generated_at timestamptz,
  ADD COLUMN IF NOT EXISTS final_rate numeric,
  ADD COLUMN IF NOT EXISTS final_total numeric,
  ADD COLUMN IF NOT EXISTS final_quote_note text,
  ADD COLUMN IF NOT EXISTS final_quote_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS quoted_at timestamptz,
  ADD COLUMN IF NOT EXISTS quoted_by_user_id uuid,
  ADD COLUMN IF NOT EXISTS customer_accepted_quote_at timestamptz,
  ADD COLUMN IF NOT EXISTS customer_rejected_quote_at timestamptz,
  ADD COLUMN IF NOT EXISTS quote_rejection_reason text,
  ADD COLUMN IF NOT EXISTS market_pair text,
  ADD COLUMN IF NOT EXISTS pricing_version text;

DO $$
BEGIN
  ALTER TABLE public.customer_orders
    DROP CONSTRAINT IF EXISTS customer_orders_pricing_mode_check;
  ALTER TABLE public.customer_orders
    ADD CONSTRAINT customer_orders_pricing_mode_check
    CHECK (pricing_mode IN ('merchant_quote'));
EXCEPTION
  WHEN others THEN
    NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.customer_orders
    DROP CONSTRAINT IF EXISTS customer_orders_quote_response_check;
  ALTER TABLE public.customer_orders
    ADD CONSTRAINT customer_orders_quote_response_check
    CHECK (
      NOT (
        customer_accepted_quote_at IS NOT NULL
        AND customer_rejected_quote_at IS NOT NULL
      )
    );
EXCEPTION
  WHEN others THEN
    NULL;
END $$;

ALTER TABLE public.customer_orders
  DROP CONSTRAINT IF EXISTS customer_orders_quoted_by_user_id_fkey;

ALTER TABLE public.customer_orders
  ADD CONSTRAINT customer_orders_quoted_by_user_id_fkey
  FOREIGN KEY (quoted_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.customer_orders
  ALTER COLUMN pricing_mode SET DEFAULT 'merchant_quote';

NOTIFY pgrst, 'reload schema';
