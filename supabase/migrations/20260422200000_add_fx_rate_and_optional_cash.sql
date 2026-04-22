-- Add FX rate tracking and support for optional cash accounts
-- This migration extends the shared order workflow with currency conversion data

-- 1. Add fx_rate column to customer_orders
ALTER TABLE public.customer_orders ADD COLUMN IF NOT EXISTS fx_rate numeric;

-- 2. Add comment documenting the field
COMMENT ON COLUMN public.customer_orders.fx_rate IS 'Exchange rate used for the order (e.g., 1 QAR = 0.27 EGP)';

-- 3. Update cash links to support "no account" option via link_kind='none'
-- The constraint already allows this implicitly - we just document it

-- 4. Create function to get merchant cash accounts (simplified)
CREATE OR REPLACE FUNCTION public.get_merchant_cash_accounts(p_merchant_id text)
RETURNS TABLE (
  id uuid,
  user_id uuid,
  name text,
  currency text,
  type text,
  status text,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    ca.id,
    ca.user_id,
    ca.name,
    ca.currency,
    ca.type,
    ca.status,
    ca.created_at,
    ca.updated_at
  FROM public.cash_accounts ca
  INNER JOIN public.merchant_profiles mp ON ca.user_id = mp.user_id
  WHERE mp.merchant_id = p_merchant_id
  AND ca.status = 'active'
  ORDER BY ca.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_merchant_cash_accounts(text) TO authenticated;

-- 5. Update create_customer_order_request to handle fx_rate and optional cash
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
  p_fx_rate numeric,
  p_note text DEFAULT NULL,
  p_merchant_cash_account_id text DEFAULT NULL,
  p_customer_cash_account_id text DEFAULT NULL
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
  v_row public.customer_orders%rowtype;
BEGIN
  -- Validate placed_by_role
  IF p_placed_by_role NOT IN ('merchant', 'customer') THEN
    RAISE EXCEPTION 'placed_by_role must be merchant or customer';
  END IF;

  -- Validate FX rate
  IF p_fx_rate IS NULL OR p_fx_rate <= 0 THEN
    RAISE EXCEPTION 'fx_rate is required and must be greater than 0';
  END IF;

  -- Get connection and validate actor ownership
  SELECT customer_user_id, merchant_id INTO v_customer_user_id, v_merchant_id
  FROM public.customer_merchant_connections
  WHERE id = p_connection_id
  AND status IN ('pending', 'active')
  LIMIT 1;

  IF v_customer_user_id IS NULL THEN
    RAISE EXCEPTION 'Connection not found or inactive';
  END IF;

  -- Validate actor is authorized for this side
  IF p_placed_by_role = 'merchant' THEN
    IF v_merchant_id != public.current_merchant_id() THEN
      RAISE EXCEPTION 'Merchant not authorized for this connection';
    END IF;
    -- Get the merchant user ID
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

  -- Insert the order with correct workflow status
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
    workflow_status,
    placed_by_role,
    placed_by_user_id,
    approval_required_from_role,
    fx_rate,
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
    CASE p_placed_by_role WHEN 'merchant' THEN 'pending_customer_approval' ELSE 'pending_merchant_approval' END,
    p_placed_by_role,
    v_placed_by_user_id,
    v_approval_required_from_role,
    p_fx_rate,
    'pending'
  )
  RETURNING * INTO v_row;

  -- Insert cash links in same transaction (optional)
  -- 'none' link_kind indicates no account selected
  IF p_placed_by_role = 'merchant' THEN
    IF p_merchant_cash_account_id IS NOT NULL THEN
      INSERT INTO public.customer_order_cash_links (
        order_id, owner_role, cash_account_id, link_kind
      ) VALUES (
        v_row.id, 'merchant', p_merchant_cash_account_id, 'send'
      );
    ELSE
      INSERT INTO public.customer_order_cash_links (
        order_id, owner_role, cash_account_id, link_kind
      ) VALUES (
        v_row.id, 'merchant', 'none', 'none'
      );
    END IF;
  END IF;

  IF p_placed_by_role = 'customer' THEN
    IF p_customer_cash_account_id IS NOT NULL THEN
      INSERT INTO public.customer_order_cash_links (
        order_id, owner_role, cash_account_id, link_kind
      ) VALUES (
        v_row.id, 'customer', p_customer_cash_account_id, 'send'
      );
    ELSE
      INSERT INTO public.customer_order_cash_links (
        order_id, owner_role, cash_account_id, link_kind
      ) VALUES (
        v_row.id, 'customer', 'none', 'none'
      );
    END IF;
  END IF;

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_customer_order_request(uuid, text, numeric, text, text, text, text, text, text, numeric, text, text, text)
  TO authenticated;

-- 6. Update edit_customer_order_request to handle fx_rate and optional cash
CREATE OR REPLACE FUNCTION public.edit_customer_order_request(
  p_order_id uuid,
  p_actor_role text,
  p_amount numeric DEFAULT NULL,
  p_fx_rate numeric DEFAULT NULL,
  p_note text DEFAULT NULL,
  p_merchant_cash_account_id text DEFAULT NULL,
  p_customer_cash_account_id text DEFAULT NULL
)
RETURNS public.customer_orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.customer_orders%rowtype;
  v_counterpart_role text;
  v_new_revision integer;
BEGIN
  -- Validate actor_role
  IF p_actor_role NOT IN ('merchant', 'customer') THEN
    RAISE EXCEPTION 'actor_role must be merchant or customer';
  END IF;

  -- Get order
  SELECT * INTO v_order FROM public.customer_orders WHERE id = p_order_id;
  IF v_order IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  -- Verify actor authorization
  IF p_actor_role = 'merchant' THEN
    IF v_order.merchant_id != public.current_merchant_id() THEN
      RAISE EXCEPTION 'Merchant not authorized for this order';
    END IF;
  ELSE
    IF auth.uid() != v_order.customer_user_id THEN
      RAISE EXCEPTION 'Customer not authorized for this order';
    END IF;
  END IF;

  -- Can only edit if order is approved
  IF v_order.workflow_status != 'approved' THEN
    RAISE EXCEPTION 'Can only edit approved orders';
  END IF;

  -- Determine counterpart role for new approval requirement
  v_counterpart_role := CASE p_actor_role WHEN 'merchant' THEN 'customer' ELSE 'merchant' END;
  v_new_revision := v_order.revision_no + 1;

  -- Update with new revision and reset approval requirement
  UPDATE public.customer_orders SET
    amount = COALESCE(p_amount, amount),
    fx_rate = COALESCE(p_fx_rate, fx_rate),
    note = COALESCE(p_note, note),
    revision_no = v_new_revision,
    workflow_status = CASE v_counterpart_role WHEN 'merchant' THEN 'pending_merchant_approval' ELSE 'pending_customer_approval' END,
    approval_required_from_role = v_counterpart_role,
    approved_by_user_id = NULL,
    approved_at = NULL,
    rejection_reason = NULL,
    rejected_by_user_id = NULL,
    rejected_at = NULL,
    edited_from_order_id = p_order_id
  WHERE id = p_order_id
  RETURNING * INTO v_order;

  -- Update cash links (optional)
  IF p_actor_role = 'merchant' THEN
    DELETE FROM public.customer_order_cash_links
    WHERE order_id = p_order_id AND owner_role = 'merchant';

    IF p_merchant_cash_account_id IS NOT NULL THEN
      INSERT INTO public.customer_order_cash_links (
        order_id, owner_role, cash_account_id, link_kind
      ) VALUES (
        p_order_id, 'merchant', p_merchant_cash_account_id, 'send'
      );
    ELSE
      INSERT INTO public.customer_order_cash_links (
        order_id, owner_role, cash_account_id, link_kind
      ) VALUES (
        p_order_id, 'merchant', 'none', 'none'
      );
    END IF;
  END IF;

  IF p_actor_role = 'customer' THEN
    DELETE FROM public.customer_order_cash_links
    WHERE order_id = p_order_id AND owner_role = 'customer';

    IF p_customer_cash_account_id IS NOT NULL THEN
      INSERT INTO public.customer_order_cash_links (
        order_id, owner_role, cash_account_id, link_kind
      ) VALUES (
        p_order_id, 'customer', p_customer_cash_account_id, 'send'
      );
    ELSE
      INSERT INTO public.customer_order_cash_links (
        order_id, owner_role, cash_account_id, link_kind
      ) VALUES (
        p_order_id, 'customer', 'none', 'none'
      );
    END IF;
  END IF;

  RETURN v_order;
END;
$$;

GRANT EXECUTE ON FUNCTION public.edit_customer_order_request(uuid, text, numeric, numeric, text, text, text)
  TO authenticated;

-- Notify about migration
NOTIFY pgrst, 'reload schema';
