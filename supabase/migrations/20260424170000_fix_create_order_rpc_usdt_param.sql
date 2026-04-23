-- Fix: ensure create_customer_order_request has p_usdt_qar_rate parameter
--
-- The 14-param version (without p_usdt_qar_rate) was causing PostgREST to fail
-- with a "function not found" error whenever the frontend included p_usdt_qar_rate
-- in the call (even as null). This blocked ALL order creation for the past several
-- days. This migration is idempotent: it drops any lingering 14-param overload and
-- ensures only the correct 15-param version exists.

-- Drop lingering 14-param version if it still exists
DROP FUNCTION IF EXISTS public.create_customer_order_request(uuid, text, numeric, text, text, text, text, text, text, numeric, text, text, text, text);

-- Ensure the 15-param version (with p_usdt_qar_rate) exists
CREATE OR REPLACE FUNCTION public.create_customer_order_request(
  p_connection_id uuid,
  p_placed_by_role text,
  p_amount numeric,
  p_order_type text,
  p_send_country text,
  p_receive_country text,
  p_send_currency text,
  p_receive_currency text,
  p_payout_rail text,
  p_fx_rate numeric DEFAULT NULL,
  p_note text DEFAULT NULL,
  p_merchant_cash_account_id text DEFAULT NULL,
  p_customer_cash_account_id text DEFAULT NULL,
  p_fulfillment_mode text DEFAULT 'complete',
  p_usdt_qar_rate numeric DEFAULT NULL
)
RETURNS public.customer_orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer_user_id uuid;
  v_merchant_id text;
  v_merchant_user_id uuid;
  v_approval_required_from_role text;
  v_placed_by_user_id uuid;
  v_required_usdt numeric;
  v_row public.customer_orders%ROWTYPE;
BEGIN
  IF p_placed_by_role NOT IN ('merchant', 'customer') THEN
    RAISE EXCEPTION 'placed_by_role must be merchant or customer';
  END IF;

  IF p_fulfillment_mode NOT IN ('complete', 'phased') THEN
    RAISE EXCEPTION 'fulfillment_mode must be complete or phased';
  END IF;

  IF p_fulfillment_mode = 'phased' THEN
    IF p_usdt_qar_rate IS NULL OR p_usdt_qar_rate <= 0 THEN
      RAISE EXCEPTION 'usdt_qar_rate is required for phased orders and must be > 0';
    END IF;
    v_required_usdt := p_amount / p_usdt_qar_rate;
  END IF;

  SELECT customer_user_id, merchant_id INTO v_customer_user_id, v_merchant_id
  FROM public.customer_merchant_connections
  WHERE id = p_connection_id
  AND status IN ('pending', 'active')
  LIMIT 1;

  IF v_customer_user_id IS NULL THEN
    RAISE EXCEPTION 'Connection not found or inactive';
  END IF;

  IF p_placed_by_role = 'merchant' THEN
    IF v_merchant_id != public.current_merchant_id() THEN
      RAISE EXCEPTION 'Merchant not authorized for this connection';
    END IF;
    SELECT user_id INTO v_merchant_user_id
    FROM public.merchant_profiles WHERE merchant_id = v_merchant_id LIMIT 1;
    v_placed_by_user_id := v_merchant_user_id;
    v_approval_required_from_role := 'customer';
  ELSE
    IF auth.uid() != v_customer_user_id THEN
      RAISE EXCEPTION 'Customer not authorized for this connection';
    END IF;
    v_placed_by_user_id := auth.uid();
    v_approval_required_from_role := 'merchant';
  END IF;

  INSERT INTO public.customer_orders (
    customer_user_id,
    merchant_id,
    connection_id,
    order_type,
    amount,
    currency,
    note,
    send_country,
    receive_country,
    send_currency,
    receive_currency,
    payout_rail,
    fx_rate,
    workflow_status,
    placed_by_role,
    placed_by_user_id,
    approval_required_from_role,
    fulfillment_mode,
    usdt_qar_rate,
    required_usdt,
    status
  ) VALUES (
    v_customer_user_id,
    v_merchant_id,
    p_connection_id,
    p_order_type,
    p_amount,
    p_send_currency,
    p_note,
    p_send_country,
    p_receive_country,
    p_send_currency,
    p_receive_currency,
    p_payout_rail,
    p_fx_rate,
    CASE p_placed_by_role WHEN 'merchant' THEN 'pending_customer_approval' ELSE 'pending_merchant_approval' END,
    p_placed_by_role,
    v_placed_by_user_id,
    v_approval_required_from_role,
    p_fulfillment_mode,
    p_usdt_qar_rate,
    v_required_usdt,
    'pending'
  )
  RETURNING * INTO v_row;

  IF p_placed_by_role = 'merchant' AND p_merchant_cash_account_id IS NOT NULL THEN
    INSERT INTO public.customer_order_cash_links (
      order_id, owner_role, cash_account_id, link_kind
    ) VALUES (
      v_row.id, 'merchant', p_merchant_cash_account_id, 'send'
    );
  END IF;

  IF p_placed_by_role = 'customer' AND p_customer_cash_account_id IS NOT NULL THEN
    INSERT INTO public.customer_order_cash_links (
      order_id, owner_role, cash_account_id, link_kind
    ) VALUES (
      v_row.id, 'customer', p_customer_cash_account_id, 'send'
    );
  END IF;

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_customer_order_request(uuid, text, numeric, text, text, text, text, text, text, numeric, text, text, text, text, numeric)
  TO authenticated;

NOTIFY pgrst, 'reload schema';
