-- Drop old overloads first to avoid signature conflicts
drop function if exists public.mirror_merchant_customer_order(
  uuid, text, text, numeric, text, numeric, numeric, text, text, text,
  text, text, text, text, text, numeric, numeric, text, jsonb, timestamptz,
  numeric, numeric, text, timestamptz, timestamptz, uuid, timestamptz, text, text, text
);
drop function if exists public.mirror_merchant_customer_order(
  uuid, text, text, numeric, text, numeric, numeric, text, text, text,
  text, text, text, text, text, numeric, numeric, text, jsonb, timestamptz,
  numeric, numeric, text, uuid, timestamptz, text, text, text
);

-- Recreate with all params having defaults so ordering is valid
create or replace function public.mirror_merchant_customer_order(
  p_connection_id       uuid,
  p_amount              numeric      default null,
  p_currency            text         default 'USDT',
  p_status              text         default 'completed',
  p_order_type          text         default 'buy',
  p_rate                numeric      default null,
  p_total               numeric      default null,
  p_note                text         default null,
  p_send_country        text         default null,
  p_receive_country     text         default null,
  p_send_currency       text         default null,
  p_receive_currency    text         default null,
  p_payout_rail         text         default null,
  p_corridor_label      text         default null,
  p_pricing_mode        text         default 'merchant_quote',
  p_guide_rate          numeric      default null,
  p_guide_total         numeric      default null,
  p_guide_source        text         default null,
  p_guide_snapshot      jsonb        default null,
  p_guide_generated_at  timestamptz  default null,
  p_final_rate          numeric      default null,
  p_final_total         numeric      default null,
  p_final_quote_note    text         default null,
  p_quoted_by_user_id   uuid         default null,
  p_customer_accepted_quote_at  timestamptz default null,
  p_customer_rejected_quote_at  timestamptz default null,
  p_quote_rejection_reason      text        default null,
  p_market_pair         text         default null,
  p_pricing_version     text         default 'merchant-sale-sync-v1'
)
returns public.customer_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer_user_id uuid;
  v_merchant_id      text;
  v_row              public.customer_orders%rowtype;
begin
  if p_amount is null then
    raise exception 'p_amount is required';
  end if;

  select customer_user_id, merchant_id
    into v_customer_user_id, v_merchant_id
  from public.customer_merchant_connections
  where id = p_connection_id
    and merchant_id = public.current_merchant_id()
    and status in ('pending', 'active')
  limit 1;

  if v_customer_user_id is null then
    raise exception 'Connection not found or not owned by current merchant';
  end if;

  insert into public.customer_orders (
    customer_user_id, merchant_id, connection_id,
    order_type, amount, currency, rate, total, status, note,
    send_country, receive_country, send_currency, receive_currency,
    payout_rail, corridor_label, pricing_mode,
    guide_rate, guide_total, guide_source, guide_snapshot, guide_generated_at,
    quoted_by_user_id, market_pair, pricing_version
  ) values (
    v_customer_user_id, v_merchant_id, p_connection_id,
    p_order_type, p_amount, p_currency, p_rate, p_total, p_status, p_note,
    p_send_country, p_receive_country, p_send_currency, p_receive_currency,
    p_payout_rail, p_corridor_label, p_pricing_mode,
    p_guide_rate, p_guide_total, p_guide_source, p_guide_snapshot, p_guide_generated_at,
    p_quoted_by_user_id, p_market_pair, p_pricing_version
  )
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.mirror_merchant_customer_order from public;
grant execute on function public.mirror_merchant_customer_order to authenticated;

notify pgrst, 'reload schema';
