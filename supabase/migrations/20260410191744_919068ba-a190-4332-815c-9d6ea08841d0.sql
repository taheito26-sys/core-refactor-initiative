
-- ============================================
-- 1. OTC Disputes Table
-- ============================================
CREATE TABLE public.otc_disputes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id uuid NOT NULL REFERENCES public.otc_trades(id) ON DELETE CASCADE,
  opened_by uuid NOT NULL,
  respondent_user_id uuid NOT NULL,
  reason text NOT NULL DEFAULT '',
  evidence_urls text[] NOT NULL DEFAULT '{}',
  respondent_evidence_urls text[] NOT NULL DEFAULT '{}',
  admin_mediator_id uuid,
  status text NOT NULL DEFAULT 'open',
  resolution text,
  resolution_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.otc_disputes ENABLE ROW LEVEL SECURITY;

-- Participants can view their disputes
CREATE POLICY "Dispute participants can view"
  ON public.otc_disputes FOR SELECT
  USING (opened_by = auth.uid() OR respondent_user_id = auth.uid());

-- Admins can view all
CREATE POLICY "Admins can view all disputes"
  ON public.otc_disputes FOR SELECT
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Opener can create
CREATE POLICY "Users can open disputes"
  ON public.otc_disputes FOR INSERT
  WITH CHECK (opened_by = auth.uid());

-- Participants can update their own evidence
CREATE POLICY "Participants can update disputes"
  ON public.otc_disputes FOR UPDATE
  USING (opened_by = auth.uid() OR respondent_user_id = auth.uid());

-- Admins can update (mediate/resolve)
CREATE POLICY "Admins can update disputes"
  ON public.otc_disputes FOR UPDATE
  USING (has_role(auth.uid(), 'admin'::app_role));

-- updated_at trigger
CREATE TRIGGER update_otc_disputes_updated_at
  BEFORE UPDATE ON public.otc_disputes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================
-- 2. Notification trigger: new OTC trade offer
-- ============================================
CREATE OR REPLACE FUNCTION public.fn_notify_otc_trade_offer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'offered' THEN
    INSERT INTO public.notifications (user_id, category, title, body, metadata)
    VALUES (
      NEW.responder_user_id,
      'deal',
      'New OTC Trade Offer',
      'You received a new OTC trade offer for ' || NEW.amount || ' ' || NEW.currency,
      jsonb_build_object('trade_id', NEW.id, 'action', 'view_trade', 'deep_link', '/marketplace?tab=trades')
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_otc_trade_offer_notify
  AFTER INSERT ON public.otc_trades
  FOR EACH ROW EXECUTE FUNCTION public.fn_notify_otc_trade_offer();

-- ============================================
-- 3. Notification trigger: OTC trade status change
-- ============================================
CREATE OR REPLACE FUNCTION public.fn_notify_otc_trade_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _notify_user_id uuid;
  _title text;
  _body text;
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status AND NEW.status IN ('confirmed', 'completed', 'cancelled', 'countered') THEN
    -- Notify the counterparty (the one who didn't make the change)
    -- We approximate: if the trade was last updated, notify the other party
    IF NEW.initiator_user_id = OLD.initiator_user_id THEN
      -- Try to notify responder if initiator changed it, or vice versa
      _notify_user_id := NEW.responder_user_id;
    ELSE
      _notify_user_id := NEW.initiator_user_id;
    END IF;

    _title := 'OTC Trade ' || initcap(NEW.status);
    _body := 'Trade for ' || NEW.amount || ' ' || NEW.currency || ' is now ' || NEW.status;

    INSERT INTO public.notifications (user_id, category, title, body, metadata)
    VALUES (
      _notify_user_id,
      'deal',
      _title,
      _body,
      jsonb_build_object('trade_id', NEW.id, 'action', 'view_trade', 'deep_link', '/marketplace?tab=trades')
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_otc_trade_status_notify
  AFTER UPDATE ON public.otc_trades
  FOR EACH ROW EXECUTE FUNCTION public.fn_notify_otc_trade_status();

-- ============================================
-- 4. Notification trigger: dispute opened
-- ============================================
CREATE OR REPLACE FUNCTION public.fn_notify_otc_dispute()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Notify respondent
  INSERT INTO public.notifications (user_id, category, title, body, metadata)
  VALUES (
    NEW.respondent_user_id,
    'deal',
    'OTC Dispute Opened',
    'A dispute has been opened against a trade you are involved in.',
    jsonb_build_object('dispute_id', NEW.id, 'trade_id', NEW.trade_id, 'action', 'view_dispute', 'deep_link', '/marketplace?tab=trades')
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_otc_dispute_notify
  AFTER INSERT ON public.otc_disputes
  FOR EACH ROW EXECUTE FUNCTION public.fn_notify_otc_dispute();
