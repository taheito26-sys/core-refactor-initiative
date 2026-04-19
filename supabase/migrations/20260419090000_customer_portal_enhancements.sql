-- Customer portal compatibility schema updates.
-- Backward-compatible additions only. Merchant tables and behavior are untouched.

ALTER TABLE public.customer_profiles
  ADD COLUMN IF NOT EXISTS country text;

ALTER TABLE public.customer_profiles
  ALTER COLUMN country SET DEFAULT 'Qatar';

ALTER TABLE public.customer_profiles
  DROP CONSTRAINT IF EXISTS customer_profiles_country_check;

ALTER TABLE public.customer_profiles
  ADD CONSTRAINT customer_profiles_country_check
  CHECK (
    country IS NULL OR country IN (
      'Qatar',
      'Egypt',
      'Saudi Arabia',
      'United Arab Emirates',
      'Kuwait',
      'Bahrain',
      'Oman'
    )
  );

ALTER TABLE public.customer_orders
  ADD COLUMN IF NOT EXISTS send_country text,
  ADD COLUMN IF NOT EXISTS receive_country text,
  ADD COLUMN IF NOT EXISTS send_currency text,
  ADD COLUMN IF NOT EXISTS receive_currency text,
  ADD COLUMN IF NOT EXISTS payout_rail text,
  ADD COLUMN IF NOT EXISTS corridor_label text;

ALTER TABLE public.customer_orders
  DROP CONSTRAINT IF EXISTS customer_orders_send_country_check;

ALTER TABLE public.customer_orders
  ADD CONSTRAINT customer_orders_send_country_check
  CHECK (
    send_country IS NULL OR send_country IN (
      'Qatar',
      'Egypt',
      'Saudi Arabia',
      'United Arab Emirates',
      'Kuwait',
      'Bahrain',
      'Oman'
    )
  );

ALTER TABLE public.customer_orders
  DROP CONSTRAINT IF EXISTS customer_orders_receive_country_check;

ALTER TABLE public.customer_orders
  ADD CONSTRAINT customer_orders_receive_country_check
  CHECK (
    receive_country IS NULL OR receive_country IN (
      'Qatar',
      'Egypt',
      'Saudi Arabia',
      'United Arab Emirates',
      'Kuwait',
      'Bahrain',
      'Oman'
    )
  );

CREATE INDEX IF NOT EXISTS customer_orders_customer_user_created_at_idx
  ON public.customer_orders (customer_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS customer_orders_customer_user_status_created_at_idx
  ON public.customer_orders (customer_user_id, status, created_at DESC);
