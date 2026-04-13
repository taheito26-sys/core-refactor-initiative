
-- Add escrow_status to otc_trades
ALTER TABLE public.otc_trades
  ADD COLUMN IF NOT EXISTS escrow_status text NOT NULL DEFAULT 'none';

-- Escrow deposits table
CREATE TABLE IF NOT EXISTS public.otc_escrow (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id uuid NOT NULL REFERENCES public.otc_trades(id) ON DELETE CASCADE,
  depositor_user_id uuid NOT NULL,
  side text NOT NULL CHECK (side IN ('cash', 'usdt')),
  amount numeric NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'USDT',
  status text NOT NULL DEFAULT 'pending',
  deposited_at timestamptz,
  released_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(trade_id, depositor_user_id)
);

ALTER TABLE public.otc_escrow ENABLE ROW LEVEL SECURITY;

-- Only trade participants can see escrow records
CREATE POLICY "escrow_select" ON public.otc_escrow FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.otc_trades t
      WHERE t.id = otc_escrow.trade_id
        AND (t.initiator_user_id = auth.uid() OR t.responder_user_id = auth.uid())
    )
  );

CREATE POLICY "escrow_insert" ON public.otc_escrow FOR INSERT TO authenticated
  WITH CHECK (
    depositor_user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.otc_trades t
      WHERE t.id = otc_escrow.trade_id
        AND (t.initiator_user_id = auth.uid() OR t.responder_user_id = auth.uid())
    )
  );

CREATE POLICY "escrow_update" ON public.otc_escrow FOR UPDATE TO authenticated
  USING (
    depositor_user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.otc_trades t
      WHERE t.id = otc_escrow.trade_id
        AND (t.initiator_user_id = auth.uid() OR t.responder_user_id = auth.uid())
    )
  );

-- Auto-release escrow when trade is completed: trigger
CREATE OR REPLACE FUNCTION public.fn_auto_release_escrow()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'completed' AND OLD.status != 'completed' THEN
    UPDATE public.otc_escrow
      SET status = 'released', released_at = now(), updated_at = now()
      WHERE trade_id = NEW.id AND status = 'deposited';
    NEW.escrow_status := 'released';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_release_escrow ON public.otc_trades;
CREATE TRIGGER trg_auto_release_escrow
  BEFORE UPDATE ON public.otc_trades
  FOR EACH ROW EXECUTE FUNCTION public.fn_auto_release_escrow();

-- Auto-update escrow_status on otc_trades when escrow records change
CREATE OR REPLACE FUNCTION public.fn_sync_escrow_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _deposited_count int;
  _trade_id uuid := COALESCE(NEW.trade_id, OLD.trade_id);
BEGIN
  SELECT COUNT(*) INTO _deposited_count
    FROM public.otc_escrow
    WHERE trade_id = _trade_id AND status = 'deposited';

  UPDATE public.otc_trades SET escrow_status = CASE
    WHEN _deposited_count >= 2 THEN 'both_deposited'
    WHEN _deposited_count = 1 THEN 'partial'
    ELSE 'none'
  END, updated_at = now()
  WHERE id = _trade_id;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_escrow_status ON public.otc_escrow;
CREATE TRIGGER trg_sync_escrow_status
  AFTER INSERT OR UPDATE ON public.otc_escrow
  FOR EACH ROW EXECUTE FUNCTION public.fn_sync_escrow_status();

-- Reputation: add columns to merchant_profiles for caching
ALTER TABLE public.merchant_profiles
  ADD COLUMN IF NOT EXISTS otc_completed_trades int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS otc_completion_rate numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS otc_total_volume numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS otc_reputation_updated_at timestamptz;

-- Function to refresh a merchant's reputation stats
CREATE OR REPLACE FUNCTION public.fn_refresh_otc_reputation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IN ('completed', 'cancelled') AND OLD.status != NEW.status THEN
    -- Update initiator stats
    UPDATE public.merchant_profiles SET
      otc_completed_trades = sub.completed,
      otc_completion_rate = CASE WHEN sub.total > 0 THEN (sub.completed::numeric / sub.total * 100) ELSE 0 END,
      otc_total_volume = sub.volume,
      otc_reputation_updated_at = now()
    FROM (
      SELECT
        COUNT(*) FILTER (WHERE status = 'completed') AS completed,
        COUNT(*) FILTER (WHERE status IN ('completed','cancelled')) AS total,
        COALESCE(SUM(CASE WHEN status = 'completed' THEN COALESCE(counter_total, total) ELSE 0 END), 0) AS volume
      FROM public.otc_trades
      WHERE initiator_user_id = NEW.initiator_user_id
    ) sub
    WHERE user_id = NEW.initiator_user_id;

    -- Update responder stats
    UPDATE public.merchant_profiles SET
      otc_completed_trades = sub.completed,
      otc_completion_rate = CASE WHEN sub.total > 0 THEN (sub.completed::numeric / sub.total * 100) ELSE 0 END,
      otc_total_volume = sub.volume,
      otc_reputation_updated_at = now()
    FROM (
      SELECT
        COUNT(*) FILTER (WHERE status = 'completed') AS completed,
        COUNT(*) FILTER (WHERE status IN ('completed','cancelled')) AS total,
        COALESCE(SUM(CASE WHEN status = 'completed' THEN COALESCE(counter_total, total) ELSE 0 END), 0) AS volume
      FROM public.otc_trades
      WHERE responder_user_id = NEW.responder_user_id
    ) sub
    WHERE user_id = NEW.responder_user_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_refresh_otc_reputation ON public.otc_trades;
CREATE TRIGGER trg_refresh_otc_reputation
  AFTER UPDATE ON public.otc_trades
  FOR EACH ROW EXECUTE FUNCTION public.fn_refresh_otc_reputation();

-- Enable realtime for escrow
ALTER PUBLICATION supabase_realtime ADD TABLE public.otc_escrow;
