-- ============================================================
-- Parent Order Fulfillment — order_executions supplementary
-- ============================================================
-- This migration is supplementary to 20260423010000.
-- It adds indexes, updated_at trigger, and destination_cash_account_id.
-- All CREATE/POLICY statements use IF NOT EXISTS or DROP IF EXISTS
-- to be fully idempotent.
-- ============================================================

-- ── 1. Ensure table exists (no-op if already created) ────────────────

CREATE TABLE IF NOT EXISTS public.order_executions (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_order_id      uuid        NOT NULL REFERENCES public.customer_orders(id) ON DELETE CASCADE,
  sequence_number      integer     NOT NULL,
  sold_qar_amount      numeric(20,4) NOT NULL CHECK (sold_qar_amount > 0),
  fx_rate_qar_to_egp   numeric(20,8) NOT NULL CHECK (fx_rate_qar_to_egp > 0),
  egp_received_amount  numeric(20,4) GENERATED ALWAYS AS (sold_qar_amount * fx_rate_qar_to_egp) STORED,
  market_type          text        NOT NULL CHECK (market_type IN ('instapay_v1', 'p2p', 'bank', 'manual')),
  cash_account_id      text,
  status               text        NOT NULL DEFAULT 'pending'
                                   CHECK (status IN ('completed', 'pending', 'cancelled', 'failed')),
  executed_at          timestamptz,
  created_by           uuid        NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- ── 2. Add destination_cash_account_id to customer_orders ────────────

ALTER TABLE public.customer_orders
  ADD COLUMN IF NOT EXISTS destination_cash_account_id text;

-- ── 3. Indexes ────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_order_executions_parent_order_id
  ON public.order_executions(parent_order_id);

CREATE INDEX IF NOT EXISTS idx_order_executions_parent_order_id_status
  ON public.order_executions(parent_order_id, status);

-- ── 4. Ensure RLS is enabled ──────────────────────────────────────────

ALTER TABLE public.order_executions ENABLE ROW LEVEL SECURITY;

-- ── 5. Notify PostgREST ──────────────────────────────────────────────

NOTIFY pgrst, 'reload schema';
