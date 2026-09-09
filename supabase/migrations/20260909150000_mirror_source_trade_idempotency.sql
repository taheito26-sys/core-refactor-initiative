-- The client-side dedup check before calling mirror_merchant_customer_order
-- compared the new row's created_at (always "now") against a +-60s window
-- around the trade's own sale date -- two values that are almost never
-- close, so every page reload re-inserted every eligible trade again with
-- no working guard. source_trade_id gives an exact, stable key per local
-- trade so both the client and the database itself can tell a trade was
-- already mirrored.
--
-- Separately: each prior CREATE OR REPLACE of this function actually
-- changed its parameter list (order and/or types), which does not replace
-- the old overload in Postgres -- it adds a new one. At least two
-- different-signature overloads of mirror_merchant_customer_order have
-- been live side by side since 20260421120000. This migration drops both
-- known stale overloads and leaves exactly one, built on the most recent
-- (34-param, cash-account-aware) version plus the new idempotency param.

drop function if exists public.mirror_merchant_customer_order(
  uuid, numeric, text, text, text, numeric, numeric, text, text, text,
  text, text, text, text, text, numeric, numeric, text, jsonb, timestamptz,
  numeric, numeric, text, uuid, timestamptz, timestamptz, text, text, text
);

drop function if exists public.mirror_merchant_customer_order(
  uuid, text, text, numeric, text, numeric, numeric, text, text, text,
  text, text, text, text, text, numeric, numeric, text, jsonb, timestamptz,
  numeric, numeric, text, timestamptz, timestamptz, uuid, timestamptz, text, text, text, text, text, text, text
);

alter table public.customer_orders
  add column if not exists source_trade_id text;

create unique index if not exists customer_orders_merchant_source_trade_idx
  on public.customer_orders (merchant_id, source_trade_id)
  where source_trade_id is not null;

create or replace function public.mirror_merchant_customer_order(
  p_connection_id uuid,
  p_status text default 'pending_quote',
  p_order_type text default 'buy',
  p_amount numeric,
  p_currency text,
  p_rate numeric default null,
  p_total numeric default null,
  p_note text default null,
  p_send_country text default null,
  p_receive_country text default null,
  p_send_currency text default null,
  p_receive_currency text default null,
  p_payout_rail text default null,
  p_corridor_label text default null,
  p_pricing_mode text default 'merchant_quote',
  p_guide_rate numeric default null,
  p_guide_total numeric default null,
  p_guide_source text default null,
  p_guide_snapshot jsonb default null,
  p_guide_generated_at timestamptz default null,
  p_final_rate numeric default null,
  p_final_total numeric default null,
  p_final_quote_note text default null,
  p_final_quote_expires_at timestamptz default null,
  p_quoted_at timestamptz default null,
  p_quoted_by_user_id uuid default null,
  p_customer_accepted_quote_at timestamptz default null,
  p_customer_rejected_quote_at timestamptz default null,
  p_quote_rejection_reason text default null,
  p_market_pair text default null,
  p_pricing_version text default 'merchant-sale-sync-v1',
  p_merchant_cash_account_id text default null,
  p_merchant_cash_account_name text default null,
  p_customer_cash_account_id text default null,
  p_customer_cash_account_name text default null,
  p_source_trade_id text default null
)
returns public.customer_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer_user_id uuid;
  v_merchant_id text;
  v_row public.customer_orders%rowtype;
begin
  select customer_user_id, merchant_id
    into v_customer_user_id, v_merchant_id
  from public.customer_merchant_connections
  where id = p_connection_id
    and merchant_id = public.current_merchant_id()
    and status in ('pending', 'active')
  limit 1;

  if v_customer_user_id is null then
    raise exception 'Customer order could not be mirrored: no active or pending customer connection was found for the current merchant';
  end if;

  -- A trade already mirrored under this exact (merchant, source_trade_id)
  -- returns the existing row instead of inserting a duplicate.
  if p_source_trade_id is not null then
    select * into v_row
    from public.customer_orders
    where merchant_id = v_merchant_id
      and source_trade_id = p_source_trade_id
    limit 1;

    if found then
      return v_row;
    end if;
  end if;

  insert into public.customer_orders (
    customer_user_id,
    merchant_id,
    connection_id,
    order_type,
    amount,
    currency,
    rate,
    total,
    status,
    note,
    send_country,
    receive_country,
    send_currency,
    receive_currency,
    payout_rail,
    corridor_label,
    pricing_mode,
    guide_rate,
    guide_total,
    guide_source,
    guide_snapshot,
    guide_generated_at,
    final_rate,
    final_total,
    final_quote_note,
    final_quote_expires_at,
    quoted_at,
    quoted_by_user_id,
    customer_accepted_quote_at,
    customer_rejected_quote_at,
    quote_rejection_reason,
    market_pair,
    pricing_version,
    merchant_cash_account_id,
    merchant_cash_account_name,
    customer_cash_account_id,
    customer_cash_account_name,
    source_trade_id
  ) values (
    v_customer_user_id,
    v_merchant_id,
    p_connection_id,
    p_order_type,
    p_amount,
    p_currency,
    p_rate,
    p_total,
    p_status,
    p_note,
    p_send_country,
    p_receive_country,
    p_send_currency,
    p_receive_currency,
    p_payout_rail,
    p_corridor_label,
    p_pricing_mode,
    p_guide_rate,
    p_guide_total,
    p_guide_source,
    p_guide_snapshot,
    p_guide_generated_at,
    p_final_rate,
    p_final_total,
    p_final_quote_note,
    p_final_quote_expires_at,
    coalesce(p_quoted_at, now()),
    p_quoted_by_user_id,
    p_customer_accepted_quote_at,
    p_customer_rejected_quote_at,
    p_quote_rejection_reason,
    p_market_pair,
    p_pricing_version,
    p_merchant_cash_account_id,
    p_merchant_cash_account_name,
    p_customer_cash_account_id,
    p_customer_cash_account_name,
    p_source_trade_id
  )
  on conflict (merchant_id, source_trade_id) where source_trade_id is not null do nothing
  returning * into v_row;

  if not found and p_source_trade_id is not null then
    -- Lost a race against a concurrent mirror of the same trade.
    select * into v_row
    from public.customer_orders
    where merchant_id = v_merchant_id
      and source_trade_id = p_source_trade_id
    limit 1;
  end if;

  return v_row;
end;
$$;

revoke all on function public.mirror_merchant_customer_order(
  uuid, text, text, numeric, text, numeric, numeric, text, text, text,
  text, text, text, text, text, numeric, numeric, text, jsonb, timestamptz,
  numeric, numeric, text, timestamptz, timestamptz, uuid, timestamptz, text, text, text, text, text, text, text, text
) from public;

grant execute on function public.mirror_merchant_customer_order(
  uuid, text, text, numeric, text, numeric, numeric, text, text, text,
  text, text, text, text, text, numeric, numeric, text, jsonb, timestamptz,
  numeric, numeric, text, timestamptz, timestamptz, uuid, timestamptz, text, text, text, text, text, text, text, text
) to authenticated;

notify pgrst, 'reload schema';
