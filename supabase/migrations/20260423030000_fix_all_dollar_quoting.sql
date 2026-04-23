-- Fix dollar-quoting for all functions from the parent order fulfillment feature
-- The original migration used single $ instead of $$ for PL/pgSQL function bodies

-- 1. Fix fn_assign_execution_sequence trigger function
CREATE OR REPLACE FUNCTION public.fn_assign_execution_sequence()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.sequence_number IS NULL THEN
    SELECT COALESCE(MAX(sequence_number), 0) + 1
    INTO NEW.sequence_number
    FROM public.order_executions
    WHERE parent_order_id = NEW.parent_order_id;
  END IF;
  RETURN NEW;
END;
$$;

-- 2. Fix insert_order_execution RPC
CREATE OR REPLACE FUNCTION public.insert_order_execution(
  p_parent_order_id uuid,
  p_sold_qar_amount numeric,
  p_fx_rate_qar_to_egp numeric,
  p_market_type text DEFAULT 'manual',
  p_cash_account_id text DEFAULT NULL
)
RETURNS public.order_executions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.customer_orders%rowtype;
  v_fulfilled_qar numeric;
  v_remaining_qar numeric;
  v_execution public.order_executions%rowtype;
BEGIN
  -- Validate inputs
  IF p_sold_qar_amount <= 0 THEN
    RAISE EXCEPTION 'sold_qar_amount must be greater than zero';
  END IF;

  IF p_fx_rate_qar_to_egp <= 0 THEN
    RAISE EXCEPTION 'fx_rate_qar_to_egp must be greater than zero';
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

  -- Calculate current fulfillment
  SELECT COALESCE(SUM(sold_qar_amount), 0) INTO v_fulfilled_qar
  FROM public.order_executions
  WHERE parent_order_id = p_parent_order_id
  AND status = 'completed';

  v_remaining_qar := v_order.amount - v_fulfilled_qar;

  -- Prevent overfill
  IF p_sold_qar_amount > v_remaining_qar THEN
    RAISE EXCEPTION 'Execution amount (%) exceeds remaining amount (%). Fulfilled: %, Total: %',
      p_sold_qar_amount, v_remaining_qar, v_fulfilled_qar, v_order.amount;
  END IF;

  -- Insert execution
  INSERT INTO public.order_executions (
    parent_order_id,
    sold_qar_amount,
    fx_rate_qar_to_egp,
    market_type,
    cash_account_id,
    status,
    created_by
  ) VALUES (
    p_parent_order_id,
    p_sold_qar_amount,
    p_fx_rate_qar_to_egp,
    p_market_type,
    p_cash_account_id,
    'completed',
    (SELECT user_id FROM public.merchant_profiles WHERE merchant_id = v_order.merchant_id LIMIT 1)
  )
  RETURNING * INTO v_execution;

  RETURN v_execution;
END;
$$;

GRANT EXECUTE ON FUNCTION public.insert_order_execution(uuid, numeric, numeric, text, text)
  TO authenticated;

-- 3. Recreate parent_order_summary view (in case it was broken)
CREATE OR REPLACE VIEW public.parent_order_summary AS
SELECT
  o.id AS parent_order_id,
  o.amount AS parent_qar_amount,
  COALESCE(SUM(CASE WHEN e.status = 'completed' THEN e.sold_qar_amount ELSE 0 END), 0) AS fulfilled_qar,
  o.amount - COALESCE(SUM(CASE WHEN e.status = 'completed' THEN e.sold_qar_amount ELSE 0 END), 0) AS remaining_qar,
  COALESCE(SUM(CASE WHEN e.status = 'completed' THEN e.egp_received_amount ELSE 0 END), 0) AS total_egp_received,
  COUNT(CASE WHEN e.status = 'completed' THEN 1 END) AS fill_count,
  CASE
    WHEN o.amount > 0 THEN
      (COALESCE(SUM(CASE WHEN e.status = 'completed' THEN e.sold_qar_amount ELSE 0 END), 0) / o.amount) * 100
    ELSE 0
  END AS progress_percent,
  CASE
    WHEN COALESCE(SUM(CASE WHEN e.status = 'completed' THEN e.sold_qar_amount ELSE 0 END), 0) > 0 THEN
      COALESCE(SUM(CASE WHEN e.status = 'completed' THEN e.egp_received_amount ELSE 0 END), 0) /
      COALESCE(SUM(CASE WHEN e.status = 'completed' THEN e.sold_qar_amount ELSE 0 END), 1)
    ELSE NULL
  END AS weighted_avg_fx,
  CASE
    WHEN COALESCE(SUM(CASE WHEN e.status = 'completed' THEN e.sold_qar_amount ELSE 0 END), 0) = 0 THEN 'unfulfilled'
    WHEN COALESCE(SUM(CASE WHEN e.status = 'completed' THEN e.sold_qar_amount ELSE 0 END), 0) < o.amount THEN 'partially_fulfilled'
    ELSE 'fully_fulfilled'
  END AS fulfillment_status
FROM public.customer_orders o
LEFT JOIN public.order_executions e ON e.parent_order_id = o.id
WHERE o.fulfillment_mode = 'phased'
GROUP BY o.id, o.amount;

GRANT SELECT ON public.parent_order_summary TO authenticated;

-- Notify PostgREST to reload schema
NOTIFY pgrst, 'reload schema';
