-- Parent Order Fulfillment: Add fulfillment_mode and order_executions table
-- This enables phased delivery where a parent order can be fulfilled through multiple executions

-- 1. Add fulfillment_mode to customer_orders
ALTER TABLE public.customer_orders 
  ADD COLUMN IF NOT EXISTS fulfillment_mode text DEFAULT 'complete';

ALTER TABLE public.customer_orders
  ADD CONSTRAINT chk_fulfillment_mode
    CHECK (fulfillment_mode IN ('complete', 'phased'));

-- 2. Create order_executions table for tracking sub-executions
CREATE TABLE IF NOT EXISTS public.order_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_order_id uuid NOT NULL REFERENCES public.customer_orders(id) ON DELETE CASCADE,
  sequence_number integer NOT NULL,
  sold_qar_amount numeric NOT NULL CHECK (sold_qar_amount > 0),
  fx_rate_qar_to_egp numeric NOT NULL CHECK (fx_rate_qar_to_egp > 0),
  egp_received_amount numeric GENERATED ALWAYS AS (sold_qar_amount * fx_rate_qar_to_egp) STORED,
  market_type text NOT NULL DEFAULT 'manual',
  cash_account_id text,
  status text NOT NULL DEFAULT 'completed',
  executed_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_market_type CHECK (market_type IN ('instapay_v1', 'p2p', 'bank', 'manual')),
  CONSTRAINT chk_execution_status CHECK (status IN ('completed', 'pending', 'cancelled', 'failed')),
  UNIQUE(parent_order_id, sequence_number)
);

-- Enable RLS on order_executions
ALTER TABLE public.order_executions ENABLE ROW LEVEL SECURITY;

-- RLS policies: merchants can view/insert executions for their orders
CREATE POLICY "Merchants can view executions on their orders" ON public.order_executions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.customer_orders
      WHERE id = parent_order_id
      AND merchant_id = public.current_merchant_id()
    )
  );

CREATE POLICY "Merchants can insert executions on their orders" ON public.order_executions
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.customer_orders
      WHERE id = parent_order_id
      AND merchant_id = public.current_merchant_id()
    )
  );

-- RLS policies: customers can view executions for their orders (read-only)
CREATE POLICY "Customers can view executions on their orders" ON public.order_executions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.customer_orders
      WHERE id = parent_order_id
      AND customer_user_id = auth.uid()
    )
  );

-- 3. Create function to auto-assign sequence numbers
CREATE OR REPLACE FUNCTION public.fn_assign_execution_sequence()
RETURNS trigger LANGUAGE plpgsql AS $
BEGIN
  IF NEW.sequence_number IS NULL THEN
    SELECT COALESCE(MAX(sequence_number), 0) + 1
    INTO NEW.sequence_number
    FROM public.order_executions
    WHERE parent_order_id = NEW.parent_order_id;
  END IF;
  RETURN NEW;
END;
$;

CREATE TRIGGER trg_assign_execution_sequence
  BEFORE INSERT ON public.order_executions
  FOR EACH ROW EXECUTE FUNCTION public.fn_assign_execution_sequence();

-- 4. Create RPC to insert order execution with overfill prevention
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
AS $
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
$;

GRANT EXECUTE ON FUNCTION public.insert_order_execution(uuid, numeric, numeric, text, text)
  TO authenticated;

-- 5. Create view for parent order summary with aggregated execution data
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

-- Grant access to the view
GRANT SELECT ON public.parent_order_summary TO authenticated;

-- 6. Update create_customer_order_request RPC to accept fulfillment_mode
DROP FUNCTION IF EXISTS public.create_customer_order_request(uuid, text, numeric, text, text, text, text, text, text, text, text, text);

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
  p_fulfillment_mode text DEFAULT 'complete'
)
RETURNS public.customer_orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $
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

  -- Validate fulfillment_mode
  IF p_fulfillment_mode NOT IN ('complete', 'phased') THEN
    RAISE EXCEPTION 'fulfillment_mode must be complete or phased';
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

  -- Insert the order with correct workflow status and fulfillment_mode
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
$;

GRANT EXECUTE ON FUNCTION public.create_customer_order_request(uuid, text, numeric, text, text, text, text, text, text, numeric, text, text, text, text)
  TO authenticated;

-- Enable realtime for order_executions
ALTER PUBLICATION supabase_realtime ADD TABLE public.order_executions;

-- Notify about schema changes
NOTIFY pgrst, 'reload schema';
