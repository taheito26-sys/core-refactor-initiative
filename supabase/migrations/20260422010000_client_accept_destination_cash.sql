-- Client order acceptance with required destination cash account
-- Adds server-side validation, order cash linkage, and acceptance ledger posting

ALTER TABLE public.cash_ledger
  ADD COLUMN IF NOT EXISTS order_id uuid REFERENCES public.customer_orders(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_cash_ledger_order_id
  ON public.cash_ledger(order_id);

CREATE OR REPLACE FUNCTION public.accept_customer_order_request(
  p_order_id uuid,
  p_customer_cash_account_id text
)
RETURNS public.customer_orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.customer_orders%rowtype;
  v_account public.cash_accounts%rowtype;
  v_merchant_user_id uuid;
  v_ledger_id text;
  v_destination_amount numeric;
  v_destination_currency text;
  v_account_type text;
BEGIN
  SELECT * INTO v_order
  FROM public.customer_orders
  WHERE id = p_order_id;

  IF v_order IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  IF auth.uid() IS NULL OR auth.uid() <> v_order.customer_user_id THEN
    RAISE EXCEPTION 'Customer not authorized for this order';
  END IF;

  IF v_order.status <> 'quoted' THEN
    RAISE EXCEPTION 'Order is not in quoted state';
  END IF;

  IF p_customer_cash_account_id IS NULL OR btrim(p_customer_cash_account_id) = '' THEN
    RAISE EXCEPTION 'Destination cash account is required';
  END IF;

  SELECT * INTO v_account
  FROM public.cash_accounts
  WHERE id = p_customer_cash_account_id
  LIMIT 1;

  IF v_account IS NULL THEN
    RAISE EXCEPTION 'Cash account not found';
  END IF;

  IF v_account.user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Cash account does not belong to the authenticated customer';
  END IF;

  IF v_account.status <> 'active' THEN
    RAISE EXCEPTION 'Cash account is not active';
  END IF;

  IF COALESCE(v_account.is_merchant_account, false) THEN
    RAISE EXCEPTION 'Merchant cash accounts are not eligible';
  END IF;

  IF v_order.receive_currency IS NOT NULL AND v_account.currency <> v_order.receive_currency THEN
    RAISE EXCEPTION 'Cash account currency is incompatible';
  END IF;

  v_account_type := lower(COALESCE(v_account.type, ''));
  IF v_order.payout_rail IN ('mobile_wallet', 'cash_pickup') THEN
    IF v_account_type NOT IN ('hand', 'cash', 'mobile_wallet', 'other') THEN
      RAISE EXCEPTION 'Cash account rail is incompatible';
    END IF;
  ELSIF v_order.payout_rail IN ('bank_transfer', 'instant_bank', 'card_payout') THEN
    IF v_account_type NOT IN ('bank', 'hand', 'cash', 'other') THEN
      RAISE EXCEPTION 'Cash account rail is incompatible';
    END IF;
  END IF;

  v_destination_currency := COALESCE(v_order.receive_currency, v_account.currency);
  v_destination_amount := COALESCE(
    v_order.final_total,
    v_order.total,
    CASE
      WHEN v_order.fx_rate IS NOT NULL THEN ROUND(v_order.amount * v_order.fx_rate, 6)
      ELSE NULL
    END
  );

  IF v_destination_amount IS NULL OR v_destination_amount <= 0 THEN
    RAISE EXCEPTION 'Order total is missing';
  END IF;

  UPDATE public.customer_orders
  SET
    customer_cash_account_id = v_account.id,
    customer_cash_account_name = v_account.name,
    customer_accepted_quote_at = now(),
    approved_by_user_id = auth.uid(),
    approved_at = now(),
    status = 'completed'
  WHERE id = p_order_id
  RETURNING * INTO v_order;

  INSERT INTO public.customer_order_cash_links (
    order_id,
    owner_role,
    cash_account_id,
    amount,
    currency,
    link_kind
  ) VALUES (
    v_order.id,
    'customer',
    v_account.id,
    v_destination_amount,
    v_destination_currency,
    'receive'
  )
  ON CONFLICT (order_id, owner_role, link_kind)
  DO UPDATE SET
    cash_account_id = EXCLUDED.cash_account_id,
    amount = EXCLUDED.amount,
    currency = EXCLUDED.currency;

  v_ledger_id := gen_random_uuid()::text;

  INSERT INTO public.cash_ledger (
    id,
    user_id,
    account_id,
    ts,
    type,
    direction,
    amount,
    currency,
    note,
    linked_entity_id,
    linked_entity_type,
    order_id
  ) VALUES (
    v_ledger_id,
    auth.uid(),
    v_account.id,
    (EXTRACT(EPOCH FROM now()) * 1000)::bigint,
    'deposit',
    'in',
    v_destination_amount,
    v_destination_currency,
    'Accepted incoming order ' || v_order.id::text,
    NULL,
    NULL,
    v_order.id
  );

  INSERT INTO public.customer_order_events (
    order_id,
    event_type,
    actor_user_id,
    metadata
  ) VALUES (
    v_order.id,
    'customer_quote_accepted',
    auth.uid(),
    jsonb_build_object(
      'destination_cash_account_id', v_account.id,
      'destination_cash_account_name', v_account.name,
      'cash_ledger_id', v_ledger_id,
      'cash_ledger_amount', v_destination_amount,
      'cash_ledger_currency', v_destination_currency
    )
  );

  SELECT user_id INTO v_merchant_user_id
  FROM public.merchant_profiles
  WHERE merchant_id = v_order.merchant_id
  LIMIT 1;

  IF v_merchant_user_id IS NOT NULL THEN
    INSERT INTO public.notifications (
      user_id,
      category,
      title,
      body,
      entity_type,
      entity_id,
      target_path,
      target_entity_type,
      target_entity_id
    ) VALUES (
      v_merchant_user_id,
      'customer_order_quote_response',
      'Customer accepted order',
      COALESCE(v_order.corridor_label, v_order.id::text),
      'customer_order',
      v_order.id::text,
      '/merchants?tab=client-orders',
      'customer_order',
      v_order.id::text
    );
  END IF;

  RETURN v_order;
END;
$$;

GRANT EXECUTE ON FUNCTION public.accept_customer_order_request(uuid, text)
  TO authenticated;

NOTIFY pgrst, 'reload schema';
