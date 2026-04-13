
-- Server-side wallet balance function
CREATE OR REPLACE FUNCTION public.customer_wallet_summary(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  -- Verify caller is the owner
  IF auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT jsonb_build_object(
    'available_balance', COALESCE(SUM(CASE WHEN status = 'completed' THEN
      CASE WHEN order_type = 'buy' THEN amount ELSE -amount END
    ELSE 0 END), 0),
    'pending_balance', COALESCE(SUM(CASE WHEN status = 'pending' THEN
      CASE WHEN order_type = 'buy' THEN amount ELSE amount END
    ELSE 0 END), 0),
    'held_balance', COALESCE(SUM(CASE WHEN status IN ('payment_sent', 'confirmed', 'awaiting_payment') THEN
      CASE WHEN order_type = 'buy' THEN amount ELSE amount END
    ELSE 0 END), 0),
    'total_completed', COALESCE(COUNT(*) FILTER (WHERE status = 'completed'), 0),
    'currency', 'USDT'
  ) INTO result
  FROM public.customer_orders
  WHERE customer_user_id = p_user_id;

  RETURN result;
END;
$$;
