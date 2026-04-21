-- Add all columns that customer_orders needs for the quote flow and merchant sync.
-- Uses ADD COLUMN IF NOT EXISTS so it's safe to run multiple times.

ALTER TABLE public.customer_orders
  ADD COLUMN IF NOT EXISTS send_country      text,
  ADD COLUMN IF NOT EXISTS receive_country   text,
  ADD COLUMN IF NOT EXISTS send_currency     text,
  ADD COLUMN IF NOT EXISTS receive_currency  text,
  ADD COLUMN IF NOT EXISTS payout_rail       text,
  ADD COLUMN IF NOT EXISTS corridor_label    text,
  ADD COLUMN IF NOT EXISTS pricing_mode      text,
  ADD COLUMN IF NOT EXISTS guide_rate        numeric,
  ADD COLUMN IF NOT EXISTS guide_total       numeric,
  ADD COLUMN IF NOT EXISTS guide_source      text,
  ADD COLUMN IF NOT EXISTS guide_snapshot    jsonb,
  ADD COLUMN IF NOT EXISTS guide_generated_at timestamptz,
  ADD COLUMN IF NOT EXISTS final_rate        numeric,
  ADD COLUMN IF NOT EXISTS final_total       numeric,
  ADD COLUMN IF NOT EXISTS final_quote_note  text,
  ADD COLUMN IF NOT EXISTS quoted_by_user_id uuid,
  ADD COLUMN IF NOT EXISTS market_pair       text,
  ADD COLUMN IF NOT EXISTS pricing_version   text;

NOTIFY pgrst, 'reload schema';
