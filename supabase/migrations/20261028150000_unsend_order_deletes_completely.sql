-- Unsend now removes the order entirely so neither side keeps any trace of it.
-- Reject-after-approval still keeps the order, marked rejected.
-- Events, verifications, cash links and executions go via ON DELETE CASCADE;
-- notifications carry no FK so they are removed here. Orders that already
-- touched money (cash links, ledger rows, settlements, executions) are refused.
CREATE OR REPLACE FUNCTION public.retract_customer_order_request(
  p_order_id uuid,
  p_actor_role text,
  p_mode text,
  p_reason text DEFAULT NULL
)
RETURNS public.customer_orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.customer_orders%rowtype;
  v_actor_user_id uuid;
  v_placer text;
BEGIN
  IF p_actor_role NOT IN ('merchant', 'customer') THEN
    RAISE EXCEPTION 'actor_role must be merchant or customer';
  END IF;
  IF p_mode NOT IN ('unsend', 'reject') THEN
    RAISE EXCEPTION 'mode must be unsend or reject';
  END IF;

  SELECT * INTO v_order FROM public.customer_orders WHERE id = p_order_id FOR UPDATE;
  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  IF p_actor_role = 'merchant' THEN
    IF v_order.merchant_id IS DISTINCT FROM public.current_merchant_id() THEN
      RAISE EXCEPTION 'Merchant not authorized for this order';
    END IF;
  ELSE
    IF auth.uid() IS DISTINCT FROM v_order.customer_user_id THEN
      RAISE EXCEPTION 'Customer not authorized for this order';
    END IF;
  END IF;
  v_actor_user_id := auth.uid();

  -- Orders created before the workflow redesign were all placed by the customer.
  v_placer := COALESCE(v_order.placed_by_role, 'customer');

  IF p_mode = 'unsend' THEN
    IF v_placer <> p_actor_role THEN
      RAISE EXCEPTION 'Only the side that placed the order can unsend it';
    END IF;
    IF v_order.workflow_status NOT IN ('pending_merchant_approval', 'pending_customer_approval', 'approved') THEN
      RAISE EXCEPTION 'This order can no longer be unsent';
    END IF;
  ELSE
    IF v_placer = p_actor_role THEN
      RAISE EXCEPTION 'The side that placed the order must unsend it instead';
    END IF;
    IF v_order.workflow_status <> 'approved' THEN
      RAISE EXCEPTION 'Only approved orders can be rejected this way';
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM public.customer_order_cash_links WHERE order_id = p_order_id)
     OR EXISTS (SELECT 1 FROM public.cash_ledger WHERE order_id = p_order_id) THEN
    RAISE EXCEPTION 'Unlink this order from its cash account first';
  END IF;
  IF EXISTS (SELECT 1 FROM public.customer_settlements WHERE customer_order_id = p_order_id) THEN
    RAISE EXCEPTION 'This order is part of a settlement and cannot be withdrawn';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.order_executions
    WHERE parent_order_id = p_order_id AND status IN ('completed', 'pending')
  ) THEN
    RAISE EXCEPTION 'This order already has executions and cannot be withdrawn';
  END IF;

  IF p_mode = 'unsend' THEN
    DELETE FROM public.notifications WHERE entity_id = p_order_id::text;
    DELETE FROM public.customer_orders WHERE id = p_order_id;
    RETURN v_order;
  END IF;

  UPDATE public.customer_orders SET
    workflow_status = 'rejected',
    approval_required_from_role = NULL,
    rejected_by_user_id = v_actor_user_id,
    rejected_at = now(),
    rejection_reason = p_reason,
    status = 'cancelled'
  WHERE id = p_order_id
  RETURNING * INTO v_order;

  RETURN v_order;
END;
$$;

GRANT EXECUTE ON FUNCTION public.retract_customer_order_request(uuid, text, text, text)
  TO authenticated;
