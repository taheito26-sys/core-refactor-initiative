
-- Preferred merchant flag
ALTER TABLE public.customer_merchant_connections
  ADD COLUMN IF NOT EXISTS is_preferred boolean NOT NULL DEFAULT false;

-- Server-side trust metrics function
CREATE OR REPLACE FUNCTION public.merchant_trust_metrics(p_merchant_id text, p_customer_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  IF auth.uid() IS DISTINCT FROM p_customer_user_id THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  -- Verify connection exists
  IF NOT EXISTS (
    SELECT 1 FROM public.customer_merchant_connections
    WHERE customer_user_id = p_customer_user_id
      AND merchant_id = p_merchant_id
      AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'No active connection';
  END IF;

  SELECT jsonb_build_object(
    'total_trades', COUNT(*),
    'completed_trades', COUNT(*) FILTER (WHERE status = 'completed'),
    'cancelled_trades', COUNT(*) FILTER (WHERE status = 'cancelled'),
    'completion_rate', CASE WHEN COUNT(*) > 0
      THEN ROUND((COUNT(*) FILTER (WHERE status = 'completed'))::numeric / COUNT(*)::numeric * 100, 1)
      ELSE 0 END,
    'avg_response_minutes', COALESCE(
      ROUND(AVG(EXTRACT(EPOCH FROM (confirmed_at - created_at)) / 60) FILTER (WHERE confirmed_at IS NOT NULL), 1),
      0
    )
  ) INTO result
  FROM public.customer_orders
  WHERE merchant_id = p_merchant_id;

  RETURN result;
END;
$$;
