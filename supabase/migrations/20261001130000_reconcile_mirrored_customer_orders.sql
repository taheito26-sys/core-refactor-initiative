-- Keeps a customer-portal order in step with the merchant trade it was
-- mirrored from (customer_orders.source_trade_id = Trade.id) after the trade
-- is edited, voided, or moved to another buyer. See
-- docs/customer-identity-lifecycle.md §2.4a.
--
--   p_connection_id NULL   the trade's buyer has no portal link any more:
--                          the row is removed from the old buyer's portal
--   different connection   the trade was reassigned to another linked buyer:
--                          the row moves to that buyer
--   p_voided               the row is marked cancelled (kept, so the buyer
--                          can see it was cancelled)
--   otherwise              amount / rate / note are brought up to date
--
-- Returns 'not_found' | 'unchanged' | 'updated' | 'moved' | 'cancelled' | 'removed'.
CREATE OR REPLACE FUNCTION public.reconcile_mirrored_customer_order(
  p_source_trade_id text,
  p_connection_id   uuid,
  p_amount          numeric,
  p_rate            numeric,
  p_note            text,
  p_voided          boolean
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_merchant_id   text := public.current_merchant_id();
  v_row           public.customer_orders%rowtype;
  v_new_customer  uuid;
  v_merchant_name text;
  v_result        text := 'unchanged';
  v_total         numeric;
BEGIN
  IF v_merchant_id IS NULL OR p_source_trade_id IS NULL THEN
    RAISE EXCEPTION 'Not a merchant session or missing trade id';
  END IF;

  SELECT * INTO v_row
  FROM public.customer_orders
  WHERE merchant_id = v_merchant_id AND source_trade_id = p_source_trade_id
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN 'not_found';
  END IF;

  IF p_connection_id IS NULL THEN
    DELETE FROM public.customer_orders WHERE id = v_row.id;
    RETURN 'removed';
  END IF;

  SELECT display_name INTO v_merchant_name
  FROM public.merchant_profiles WHERE merchant_id = v_merchant_id LIMIT 1;

  IF p_connection_id IS DISTINCT FROM v_row.connection_id THEN
    SELECT customer_user_id INTO v_new_customer
    FROM public.customer_merchant_connections
    WHERE id = p_connection_id
      AND merchant_id = v_merchant_id
      AND status IN ('pending', 'active');
    IF v_new_customer IS NULL THEN
      RAISE EXCEPTION 'Connection not found or not owned by current merchant';
    END IF;
    UPDATE public.customer_orders
    SET connection_id = p_connection_id, customer_user_id = v_new_customer
    WHERE id = v_row.id;
    v_row.customer_user_id := v_new_customer;
    v_result := 'moved';
  END IF;

  IF p_voided THEN
    IF v_row.workflow_status IS DISTINCT FROM 'cancelled' THEN
      UPDATE public.customer_orders
      SET workflow_status = 'cancelled', status = 'cancelled'
      WHERE id = v_row.id;
      INSERT INTO public.notifications (user_id, category, title, body, target_path, target_entity_type, target_entity_id)
      VALUES (
        v_row.customer_user_id, 'customer_order',
        COALESCE(v_merchant_name, 'Your merchant') || ' cancelled an order',
        v_row.amount || ' ' || v_row.currency,
        '/c/orders', 'customer_order', v_row.id::text
      );
      RETURN 'cancelled';
    END IF;
    RETURN v_result;
  END IF;

  v_total := p_amount * p_rate;
  IF v_row.amount IS DISTINCT FROM p_amount
     OR v_row.rate IS DISTINCT FROM p_rate
     OR v_row.note IS DISTINCT FROM p_note
     OR v_row.workflow_status IS DISTINCT FROM 'approved' THEN
    UPDATE public.customer_orders
    SET amount = p_amount,
        rate = p_rate,
        total = v_total,
        final_rate = p_rate,
        final_total = v_total,
        note = p_note,
        status = 'completed',
        workflow_status = 'approved',
        approved_at = COALESCE(approved_at, now()),
        revision_no = COALESCE(revision_no, 1) + 1
    WHERE id = v_row.id;
    -- An un-cancelled or relabelled-only row is not news to the buyer; a
    -- changed amount or rate is.
    IF v_row.amount IS DISTINCT FROM p_amount OR v_row.rate IS DISTINCT FROM p_rate THEN
      INSERT INTO public.notifications (user_id, category, title, body, target_path, target_entity_type, target_entity_id)
      VALUES (
        v_row.customer_user_id, 'customer_order',
        COALESCE(v_merchant_name, 'Your merchant') || ' updated an order',
        p_amount || ' ' || v_row.currency || ' @ ' || p_rate,
        '/c/orders', 'customer_order', v_row.id::text
      );
    END IF;
    IF v_result = 'unchanged' THEN v_result := 'updated'; END IF;
  END IF;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_mirrored_customer_order(text, uuid, numeric, numeric, text, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.reconcile_mirrored_customer_order(text, uuid, numeric, numeric, text, boolean) TO authenticated;

NOTIFY pgrst, 'reload schema';
