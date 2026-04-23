-- ============================================================
-- Fix parent_order_summary view for USDT-based progress
-- Must DROP first because column order changed from previous migration
-- ============================================================

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
  -- Progress based on USDT (falls back to QAR-based if no required_usdt)
  CASE
    WHEN COALESCE(o.required_usdt, 0) > 0 THEN
      LEAST((COALESCE(SUM(CASE WHEN e.status = 'completed' THEN e.phase_usdt ELSE 0 END), 0) / o.required_usdt) * 100, 100)
    WHEN o.amount > 0 THEN
      LEAST((COALESCE(SUM(CASE WHEN e.status = 'completed' THEN e.phase_consumed_qar ELSE 0 END), 0) / o.amount) * 100, 100)
    ELSE 0
  END AS progress_percent,
  -- Weighted avg FX = total_egp / total_consumed_qar (never a simple average)
  CASE
    WHEN COALESCE(SUM(CASE WHEN e.status = 'completed' THEN e.phase_consumed_qar ELSE 0 END), 0) > 0 THEN
      COALESCE(SUM(CASE WHEN e.status = 'completed' THEN e.executed_egp ELSE 0 END), 0) /
      COALESCE(SUM(CASE WHEN e.status = 'completed' THEN e.phase_consumed_qar ELSE 0 END), 1)
    ELSE NULL
  END AS weighted_avg_fx,
  -- Fulfillment status based on USDT (falls back to QAR if no required_usdt)
  CASE
    WHEN COALESCE(SUM(CASE WHEN e.status = 'completed' THEN e.phase_usdt ELSE 0 END), 0) = 0 THEN 'unfulfilled'
    WHEN COALESCE(SUM(CASE WHEN e.status = 'completed' THEN e.phase_usdt ELSE 0 END), 0) < COALESCE(o.required_usdt, o.amount) THEN 'partially_fulfilled'
    ELSE 'fully_fulfilled'
  END AS fulfillment_status
FROM public.customer_orders o
LEFT JOIN public.order_executions e ON e.parent_order_id = o.id
WHERE o.fulfillment_mode = 'phased'
GROUP BY o.id, o.amount, o.usdt_qar_rate, o.required_usdt;

GRANT SELECT ON public.parent_order_summary TO authenticated;

NOTIFY pgrst, 'reload schema';
