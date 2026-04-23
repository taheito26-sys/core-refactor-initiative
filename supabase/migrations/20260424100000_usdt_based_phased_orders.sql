-- ============================================================
-- USDT-Based Phased Order Fulfillment
-- ============================================================
-- Adds USDT intermediary currency support for phased orders.
-- Parent orders store usdt_qar_rate and required_usdt.
-- Phases store executed_egp, egp_per_usdt, and derived snapshots.
-- Progress is tracked as fulfilled_usdt / required_usdt.
-- ============================================================

-- ── 1. Add USDT columns to customer_orders ───────────────────────────

ALTER TABLE public.customer_orders
  ADD COLUMN IF NOT EXISTS usdt_qar_rate numeric(20,8),
  ADD COLUMN IF NOT EXISTS required_usdt numeric(20,6);

-- ── 2. Add new phase columns to order_executions ─────────────────────

ALTER TABLE public.order_executions
  ADD COLUMN IF NOT EXISTS executed_egp numeric(20,4),
  ADD COLUMN IF NOT EXISTS egp_per_usdt numeric(20,8),
  ADD COLUMN IF NOT EXISTS phase_usdt numeric(20,6),
  ADD COLUMN IF NOT EXISTS phase_consumed_qar numeric(20,4),
  ADD COLUMN IF NOT EXISTS phase_qar_egp_fx numeric(20,8);

-- ── 3. Update insert_order_execution RPC for USDT-based phases ───────

CREATE OR REPLACE FUNCTION public.insert_order_execution(
  p_parent_order_id uuid,
  p_executed_egp numeric,
  p_egp_per_usdt numeric,
  p_market_type text DEFAULT 'manual',
  p_cash_account_id text DEFAULT NULL,
  -- Legacy params (kept for backward compat, ignored if new params provided)
  p_sold_qar_amount numeric DEFAULT NULL,
  p_fx_rate_qar_to_egp numeric DEFAULT NULL
)
RETURNS public.order_executions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.customer_orders%ROWTYPE;
  v_usdt_qar_rate numeric;
  v_required_usdt numeric;
  v_fulfilled_usdt numeric;
  v_remaining_usdt numeric;
  v_phase_usdt numeric;
  v_phase_consumed_qar numeric;
  v_phase_qar_egp_fx numeric;
  v_sold_qar numeric;
  v_fx_rate numeric;
  v_execution public.order_executions%ROWTYPE;
BEGIN
  -- Validate inputs
  IF p_executed_egp IS NULL OR p_executed_egp <= 0 THEN
    RAISE EXCEPTION 'executed_egp must be greater than zero';
  END IF;

  IF p_egp_per_usdt IS NULL OR p_egp_per_usdt <= 0 THEN
    RAISE EXCEPTION 'egp_per_usdt must be greater than zero';
  END IF;

  -- Lock parent order row to prevent race conditions
  SELECT * INTO v_order
  FROM public.customer_orders
  WHERE id = p_parent_order_id
  FOR UPDATE;

  IF v_order IS NULL THEN
    RAISE EXCEPTION 'Parent order not found';
  END IF;

  -- Verify merchant authorization
  IF v_order.merchant_id != public.current_merchant_id() THEN
    RAISE EXCEPTION 'Merchant not authorized for this order';
  END IF;

  -- Verify order is in phased fulfillment mode
  IF v_order.fulfillment_mode != 'phased' THEN
    RAISE EXCEPTION 'Order is not in phased fulfillment mode';
  END IF;

  -- Get USDT/QAR rate from parent order
  v_usdt_qar_rate := v_order.usdt_qar_rate;
  v_required_usdt := v_order.required_usdt;

  IF v_usdt_qar_rate IS NULL OR v_usdt_qar_rate <= 0 THEN
    RAISE EXCEPTION 'Parent order missing usdt_qar_rate';
  END IF;

  IF v_required_usdt IS NULL OR v_required_usdt <= 0 THEN
    RAISE EXCEPTION 'Parent order missing required_usdt';
  END IF;

  -- Calculate phase snapshot values
  v_phase_usdt := p_executed_egp / p_egp_per_usdt;
  v_phase_consumed_qar := v_phase_usdt * v_usdt_qar_rate;
  v_phase_qar_egp_fx := p_executed_egp / v_phase_consumed_qar;

  -- Also compute legacy columns for backward compat
  v_sold_qar := v_phase_consumed_qar;
  v_fx_rate := v_phase_qar_egp_fx;

  -- Calculate current USDT fulfillment
  SELECT COALESCE(SUM(phase_usdt), 0) INTO v_fulfilled_usdt
  FROM public.order_executions
  WHERE parent_order_id = p_parent_order_id
  AND status = 'completed';

  v_remaining_usdt := v_required_usdt - v_fulfilled_usdt;

  -- Prevent overfill in USDT space (with small tolerance for rounding)
  IF v_phase_usdt > v_remaining_usdt + 0.01 THEN
    RAISE EXCEPTION 'Phase USDT (%) exceeds remaining USDT (%). Fulfilled: %, Required: %',
      round(v_phase_usdt, 6), round(v_remaining_usdt, 6), round(v_fulfilled_usdt, 6), round(v_required_usdt, 6);
  END IF;

  -- Insert execution with all snapshot values
  INSERT INTO public.order_executions (
    parent_order_id,
    sold_qar_amount,
    fx_rate_qar_to_egp,
    executed_egp,
    egp_per_usdt,
    phase_usdt,
    phase_consumed_qar,
    phase_qar_egp_fx,
    market_type,
    cash_account_id,
    status,
    created_by
  ) VALUES (
    p_parent_order_id,
    v_sold_qar,
    v_fx_rate,
    p_executed_egp,
    p_egp_per_usdt,
    v_phase_usdt,
    v_phase_consumed_qar,
    v_phase_qar_egp_fx,
    p_market_type,
    p_cash_account_id,
    'completed',
    (SELECT user_id FROM public.merchant_profiles WHERE merchant_id = v_order.merchant_id LIMIT 1)
  )
  RETURNING * INTO v_execution;

  RETURN v_execution;
END;
$$;

-- Grant execute
GRANT EXECUTE ON FUNCTION public.insert_order_execution(uuid, numeric, numeric, text, text, numeric, numeric)
  TO authenticated;

-- ── 4. Update parent_order_summary view for USDT-based progress ──────

-- Must DROP first because column order changes (PostgreSQL restriction)
DROP VIEW IF EXISTS public.parent_order_summary;

CREATE VIEW public.parent_order_summary AS
SELECT
  o.id AS parent_order_id,
  o.amount AS parent_qar_amount,
  o.usdt_qar_rate,
  o.required_usdt,
  -- USDT-based aggregates
  COALESCE(SUM(CASE WHEN e.status = 'completed' THEN e.phase_usdt ELSE 0 END), 0) AS total_fulfilled_usdt,
  COALESCE(o.required_usdt, 0) - COALESCE(SUM(CASE WHEN e.status = 'completed' THEN e.phase_usdt ELSE 0 END), 0) AS remaining_usdt,
  -- QAR/EGP aggregates (derived from phase snapshots)
  COALESCE(SUM(CASE WHEN e.status = 'completed' THEN e.phase_consumed_qar ELSE 0 END), 0) AS fulfilled_qar,
  o.amount - COALESCE(SUM(CASE WHEN e.status = 'completed' THEN e.phase_consumed_qar ELSE 0 END), 0) AS remaining_qar,
  COALESCE(SUM(CASE WHEN e.status = 'completed' THEN e.executed_egp ELSE 0 END), 0) AS total_egp_received,
  COUNT(CASE WHEN e.status = 'completed' THEN 1 END) AS fill_count,
  -- Progress based on USDT
  CASE
    WHEN COALESCE(o.required_usdt, 0) > 0 THEN
      LEAST((COALESCE(SUM(CASE WHEN e.status = 'completed' THEN e.phase_usdt ELSE 0 END), 0) / o.required_usdt) * 100, 100)
    ELSE 0
  END AS progress_percent,
  -- Weighted avg FX = total_egp / total_consumed_qar
  CASE
    WHEN COALESCE(SUM(CASE WHEN e.status = 'completed' THEN e.phase_consumed_qar ELSE 0 END), 0) > 0 THEN
      COALESCE(SUM(CASE WHEN e.status = 'completed' THEN e.executed_egp ELSE 0 END), 0) /
      COALESCE(SUM(CASE WHEN e.status = 'completed' THEN e.phase_consumed_qar ELSE 0 END), 1)
    ELSE NULL
  END AS weighted_avg_fx,
  -- Fulfillment status based on USDT
  CASE
    WHEN COALESCE(SUM(CASE WHEN e.status = 'completed' THEN e.phase_usdt ELSE 0 END), 0) = 0 THEN 'unfulfilled'
    WHEN COALESCE(SUM(CASE WHEN e.status = 'completed' THEN e.phase_usdt ELSE 0 END), 0) < COALESCE(o.required_usdt, o.amount) THEN 'partially_fulfilled'
    ELSE 'fully_fulfilled'
  END AS fulfillment_status
FROM public.customer_orders o
LEFT JOIN public.order_executions e ON e.parent_order_id = o.id
WHERE o.fulfillment_mode = 'phased'
GROUP BY o.id, o.amount, o.usdt_qar_rate, o.required_usdt;

-- Grant access
GRANT SELECT ON public.parent_order_summary TO authenticated;

-- ── 5. Update create_customer_order_request to accept USDT rate ──────

DROP FUNCTION IF EXISTS public.create_customer_order_request(uuid, text, numeric, text, text, text, text, text, text, numeric, text, text, text, text);

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
  -- Validate placed_by_role
  IF p_placed_by_role NOT IN ('merchant', 'customer') THEN
    RAISE EXCEPTION 'placed_by_role must be merchant or customer';
  END IF;

  -- Validate fulfillment_mode
  IF p_fulfillment_mode NOT IN ('complete', 'phased') THEN
    RAISE EXCEPTION 'fulfillment_mode must be complete or phased';
  END IF;

  -- For phased orders, usdt_qar_rate is required
  IF p_fulfillment_mode = 'phased' THEN
    IF p_usdt_qar_rate IS NULL OR p_usdt_qar_rate <= 0 THEN
      RAISE EXCEPTION 'usdt_qar_rate is required for phased orders and must be > 0';
    END IF;
    v_required_usdt := p_amount / p_usdt_qar_rate;
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

  -- Insert the order
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

  -- Insert cash links in same transaction
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

-- Notify PostgREST
NOTIFY pgrst, 'reload schema';
