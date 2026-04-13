-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: capital ledger reversal support + settlement RPCs
-- Fixes:
--   Risk 2 – pool_balance_after computed correctly in reversal RPC
--   Risk 3 – approve/reject wrapped in atomic RPC (no partial state)
--   Risk 4 – period marked pending_settlement (not settled) until approval
--   Risk 5 – original_entry_id column added for audit trail
--   Risk 6 – unique index prevents double-entry per period
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Add original_entry_id column (Risk 5) ─────────────────────────────────
ALTER TABLE public.deal_capital_ledger
  ADD COLUMN IF NOT EXISTS original_entry_id UUID
    REFERENCES public.deal_capital_ledger(id) ON DELETE SET NULL;

-- ── 2. Allow 'reversal' type (extend validator trigger) ───────────────────────
CREATE OR REPLACE FUNCTION public.validate_capital_ledger_type()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.type NOT IN ('reinvest', 'withdrawal', 'payout', 'reversal') THEN
    RAISE EXCEPTION 'Invalid capital ledger type: %', NEW.type;
  END IF;
  RETURN NEW;
END;
$$;

-- ── 3. Unique index: only one non-reversal entry per period (Risk 6) ──────────
CREATE UNIQUE INDEX IF NOT EXISTS uniq_capital_ledger_period_non_reversal
  ON public.deal_capital_ledger (period_id)
  WHERE period_id IS NOT NULL AND type != 'reversal';

-- ── 4. RPC: approve_settlement (Risk 3 + Risk 4) ─────────────────────────────
-- Atomically approves a pending settlement and marks the linked period settled.
CREATE OR REPLACE FUNCTION public.approve_settlement(_settlement_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _rows_updated INT;
BEGIN
  -- Approve only if still pending (idempotency)
  UPDATE merchant_settlements
    SET status = 'approved'
    WHERE id = _settlement_id AND status = 'pending';
  GET DIAGNOSTICS _rows_updated = ROW_COUNT;

  IF _rows_updated = 0 THEN
    RAISE EXCEPTION 'Settlement % not found or already processed', _settlement_id;
  END IF;

  -- Advance linked period from pending_settlement → settled
  UPDATE settlement_periods
    SET status = 'settled'
    WHERE settlement_id = _settlement_id
      AND status = 'pending_settlement';
END;
$$;

GRANT EXECUTE ON FUNCTION public.approve_settlement(UUID) TO authenticated;

-- ── 5. RPC: reject_settlement (Risk 2 + Risk 3 + Risk 4 + Risk 6) ─────────────
-- Atomically rejects a pending settlement:
--   a) marks settlement rejected
--   b) resets linked period back to 'due'
--   c) creates a reversal ledger entry with correct pool_balance_after
--   d) guards against double-reversal
CREATE OR REPLACE FUNCTION public.reject_settlement(
  _settlement_id UUID,
  _actor_id      UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _rows_updated    INT;
  _period          RECORD;
  _cap_entry       RECORD;
  _current_pool    DECIMAL;
BEGIN
  -- a) Reject only if still pending (idempotency, Risk 6)
  UPDATE merchant_settlements
    SET status = 'rejected'
    WHERE id = _settlement_id AND status = 'pending';
  GET DIAGNOSTICS _rows_updated = ROW_COUNT;

  IF _rows_updated = 0 THEN
    RAISE EXCEPTION 'Settlement % not found or already processed', _settlement_id;
  END IF;

  -- b) Find and reset linked period (Risk 4)
  SELECT id, deal_id INTO _period
    FROM settlement_periods
    WHERE settlement_id = _settlement_id
      AND status = 'pending_settlement';

  IF _period.id IS NOT NULL THEN
    UPDATE settlement_periods
      SET status       = 'due',
          resolution   = NULL,
          resolved_by  = NULL,
          resolved_at  = NULL,
          settled_amount = 0,
          settlement_id  = NULL
      WHERE id = _period.id;

    -- c) Find the payout capital ledger entry for this period
    SELECT * INTO _cap_entry
      FROM deal_capital_ledger
      WHERE period_id = _period.id
        AND type = 'payout'
      LIMIT 1;

    IF _cap_entry.id IS NOT NULL THEN
      -- Guard: skip if already reversed (Risk 6 double-reversal)
      IF NOT EXISTS (
        SELECT 1 FROM deal_capital_ledger
        WHERE original_entry_id = _cap_entry.id AND type = 'reversal'
      ) THEN
        -- Risk 2: correct pool_balance_after — payout doesn't change pool,
        -- reversal also doesn't; use current pool balance at reversal time.
        SELECT public.deal_reinvested_pool(_cap_entry.deal_id)
          INTO _current_pool;

        INSERT INTO deal_capital_ledger (
          deal_id, relationship_id, type, amount, currency,
          period_id, initiated_by,
          pool_balance_after,    -- Risk 2: always current pool, not stale snapshot
          original_entry_id,     -- Risk 5: audit trail back to original payout
          note
        ) VALUES (
          _cap_entry.deal_id,
          _cap_entry.relationship_id,
          'reversal',
          _cap_entry.amount,
          _cap_entry.currency,
          _period.id,
          _actor_id,
          _current_pool,
          _cap_entry.id,
          'Reversal: payout rejected for settlement ' || _settlement_id::text
        );
      END IF;
    END IF;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reject_settlement(UUID, UUID) TO authenticated;
