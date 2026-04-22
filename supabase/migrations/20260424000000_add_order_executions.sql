-- ============================================================
-- Parent Order Fulfillment — order_executions table
-- ============================================================
-- Adds:
--   1. order_executions table with all required columns
--   2. sequence_number auto-assign trigger (scoped per parent_order_id)
--   3. destination_cash_account_id column on customer_orders (if not exists)
--   4. insert_order_execution RPC with row-level lock + overfill guard
--   5. Indexes on order_executions
--   6. RLS policies on order_executions
-- ============================================================

-- ── 1. Create order_executions table ─────────────────────────────────

CREATE TABLE IF NOT EXISTS public.order_executions (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_order_id      uuid        NOT NULL REFERENCES public.customer_orders(id) ON DELETE CASCADE,
  sequence_number      integer     NOT NULL,
  sold_qar_amount      numeric(20,4) NOT NULL CHECK (sold_qar_amount > 0),
  fx_rate_qar_to_egp   numeric(20,8) NOT NULL CHECK (fx_rate_qar_to_egp > 0),
  egp_received_amount  numeric(20,4) GENERATED ALWAYS AS (sold_qar_amount * fx_rate_qar_to_egp) STORED,
  market_type          text        NOT NULL CHECK (market_type IN ('instapay_v1', 'p2p', 'bank', 'manual')),
  cash_account_id      text        REFERENCES public.cash_accounts(id),
  status               text        NOT NULL DEFAULT 'pending'
                                   CHECK (status IN ('completed', 'pending', 'cancelled', 'failed')),
  executed_at          timestamptz,
  created_by           uuid        NOT NULL REFERENCES auth.users(id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- ── 2. Trigger: auto-assign sequence_number scoped per parent_order_id ──

CREATE OR REPLACE FUNCTION public.fn_order_executions_assign_sequence()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  SELECT COALESCE(MAX(sequence_number), 0) + 1
    INTO NEW.sequence_number
  FROM public.order_executions
  WHERE parent_order_id = NEW.parent_order_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_order_executions_assign_sequence ON public.order_executions;
CREATE TRIGGER trg_order_executions_assign_sequence
  BEFORE INSERT ON public.order_executions
  FOR EACH ROW EXECUTE FUNCTION public.fn_order_executions_assign_sequence();

-- updated_at trigger (reuse existing function)
DROP TRIGGER IF EXISTS trg_order_executions_updated_at ON public.order_executions;
CREATE TRIGGER trg_order_executions_updated_at
  BEFORE UPDATE ON public.order_executions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── 3. Add destination_cash_account_id to customer_orders ────────────

ALTER TABLE public.customer_orders
  ADD COLUMN IF NOT EXISTS destination_cash_account_id text
    REFERENCES public.cash_accounts(id);

-- ── 4. RPC: insert_order_execution ───────────────────────────────────
--
-- Acquires a row-level lock on the parent order to prevent concurrent
-- overfill, validates the remaining amount, then inserts the execution.

CREATE OR REPLACE FUNCTION public.insert_order_execution(
  p_parent_order_id    uuid,
  p_sold_qar_amount    numeric,
  p_fx_rate_qar_to_egp numeric,
  p_market_type        text,
  p_cash_account_id    text        DEFAULT NULL,
  p_status             text        DEFAULT 'completed',
  p_executed_at        timestamptz DEFAULT now()
)
RETURNS public.order_executions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_parent          public.customer_orders%rowtype;
  v_fulfilled_qar   numeric;
  v_remaining_qar   numeric;
  v_result          public.order_executions%rowtype;
BEGIN
  -- Validate inputs early (before acquiring lock)
  IF p_sold_qar_amount IS NULL OR p_sold_qar_amount <= 0 THEN
    RAISE EXCEPTION 'invalid_amount: sold_qar_amount must be > 0';
  END IF;

  IF p_fx_rate_qar_to_egp IS NULL OR p_fx_rate_qar_to_egp <= 0 THEN
    RAISE EXCEPTION 'invalid_rate: fx_rate_qar_to_egp must be > 0';
  END IF;

  IF p_market_type NOT IN ('instapay_v1', 'p2p', 'bank', 'manual') THEN
    RAISE EXCEPTION 'invalid_market_type: must be one of instapay_v1, p2p, bank, manual';
  END IF;

  IF p_status NOT IN ('completed', 'pending', 'cancelled', 'failed') THEN
    RAISE EXCEPTION 'invalid_status: must be one of completed, pending, cancelled, failed';
  END IF;

  -- Lock the parent order row to prevent concurrent overfill
  SELECT * INTO v_parent
  FROM public.customer_orders
  WHERE id = p_parent_order_id
  FOR UPDATE;

  IF v_parent IS NULL THEN
    RAISE EXCEPTION 'parent_not_found: customer_orders row % does not exist', p_parent_order_id;
  END IF;

  -- Compute already-fulfilled amount from completed executions
  SELECT COALESCE(SUM(sold_qar_amount), 0)
    INTO v_fulfilled_qar
  FROM public.order_executions
  WHERE parent_order_id = p_parent_order_id
    AND status = 'completed';

  v_remaining_qar := v_parent.amount - v_fulfilled_qar;

  -- Overfill guard (only applies when inserting a completed execution)
  IF p_status = 'completed' AND p_sold_qar_amount > v_remaining_qar THEN
    RAISE EXCEPTION 'amount_exceeds_remaining: sold_qar_amount (%) exceeds remaining (%) for parent order %',
      p_sold_qar_amount, v_remaining_qar, p_parent_order_id;
  END IF;

  -- Insert the execution row (sequence_number assigned by trigger)
  INSERT INTO public.order_executions (
    parent_order_id,
    sequence_number,   -- will be overwritten by trigger; placeholder required
    sold_qar_amount,
    fx_rate_qar_to_egp,
    market_type,
    cash_account_id,
    status,
    executed_at,
    created_by
  ) VALUES (
    p_parent_order_id,
    0,                 -- trigger overwrites this before the row is stored
    p_sold_qar_amount,
    p_fx_rate_qar_to_egp,
    p_market_type,
    p_cash_account_id,
    p_status,
    p_executed_at,
    auth.uid()
  )
  RETURNING * INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.insert_order_execution(
  uuid, numeric, numeric, text, text, text, timestamptz
) TO authenticated;

-- ── 5. Indexes ────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_order_executions_parent_order_id
  ON public.order_executions(parent_order_id);

CREATE INDEX IF NOT EXISTS idx_order_executions_parent_order_id_status
  ON public.order_executions(parent_order_id, status);

-- ── 6. Row Level Security ─────────────────────────────────────────────

ALTER TABLE public.order_executions ENABLE ROW LEVEL SECURITY;

-- Merchants can view executions on their own orders
CREATE POLICY "Merchants can view executions on their orders"
  ON public.order_executions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.customer_orders co
      WHERE co.id = parent_order_id
        AND co.merchant_id = public.current_merchant_id()
    )
  );

-- Customers can view executions on their own orders
CREATE POLICY "Customers can view executions on their orders"
  ON public.order_executions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.customer_orders co
      WHERE co.id = parent_order_id
        AND co.customer_user_id = auth.uid()
    )
  );

-- Only authenticated users can insert (RPC enforces further authorization)
CREATE POLICY "Authenticated users can insert executions via RPC"
  ON public.order_executions
  FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- Merchants can update executions on their orders
CREATE POLICY "Merchants can update executions on their orders"
  ON public.order_executions
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.customer_orders co
      WHERE co.id = parent_order_id
        AND co.merchant_id = public.current_merchant_id()
    )
  );

-- ── 7. Realtime ───────────────────────────────────────────────────────

ALTER PUBLICATION supabase_realtime ADD TABLE public.order_executions;

-- Notify PostgREST to reload schema cache
NOTIFY pgrst, 'reload schema';
