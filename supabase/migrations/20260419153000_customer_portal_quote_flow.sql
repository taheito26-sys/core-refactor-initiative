-- Customer portal quote flow columns and safeguards
alter table public.customer_orders
  add column if not exists corridor_label text,
  add column if not exists pricing_mode text not null default 'merchant_quote',
  add column if not exists guide_rate numeric null,
  add column if not exists guide_total numeric null,
  add column if not exists guide_source text null,
  add column if not exists guide_snapshot jsonb null,
  add column if not exists guide_generated_at timestamptz null,
  add column if not exists final_rate numeric null,
  add column if not exists final_total numeric null,
  add column if not exists final_quote_note text null,
  add column if not exists final_quote_expires_at timestamptz null,
  add column if not exists quoted_at timestamptz null,
  add column if not exists quoted_by_user_id uuid null,
  add column if not exists customer_accepted_quote_at timestamptz null,
  add column if not exists customer_rejected_quote_at timestamptz null,
  add column if not exists quote_rejection_reason text null,
  add column if not exists market_pair text null,
  add column if not exists pricing_version text null;

alter table public.customer_orders
  drop constraint if exists customer_orders_pricing_mode_check;

alter table public.customer_orders
  add constraint customer_orders_pricing_mode_check
  check (pricing_mode in ('merchant_quote'));

alter table public.customer_orders
  drop constraint if exists customer_orders_quote_response_exclusive_check;

alter table public.customer_orders
  add constraint customer_orders_quote_response_exclusive_check
  check (not (customer_accepted_quote_at is not null and customer_rejected_quote_at is not null));
