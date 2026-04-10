
-- 1. Escrow deposit notification trigger
CREATE OR REPLACE FUNCTION public.fn_notify_otc_escrow_deposit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _trade record;
  _notify_user_id uuid;
BEGIN
  IF NEW.status = 'deposited' AND (OLD.status IS NULL OR OLD.status <> 'deposited') THEN
    SELECT * INTO _trade FROM public.otc_trades WHERE id = NEW.trade_id;
    IF FOUND THEN
      IF _trade.initiator_user_id = NEW.depositor_user_id THEN
        _notify_user_id := _trade.responder_user_id;
      ELSE
        _notify_user_id := _trade.initiator_user_id;
      END IF;

      INSERT INTO public.notifications (user_id, category, title, body, target_path, target_tab, target_entity_type, target_entity_id, dedupe_key)
      VALUES (
        _notify_user_id,
        'deal',
        'Escrow Deposit Received',
        'Your counterparty deposited ' || NEW.amount || ' ' || NEW.currency || ' into escrow',
        '/marketplace',
        'trades',
        'otc_trade',
        NEW.trade_id::text,
        'otc_escrow_' || NEW.trade_id || '_' || NEW.depositor_user_id
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_otc_escrow_notify ON public.otc_escrow;
CREATE TRIGGER trg_otc_escrow_notify
  AFTER INSERT OR UPDATE ON public.otc_escrow
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_notify_otc_escrow_deposit();

-- 2. Update existing trade offer notify to include deep-link fields
CREATE OR REPLACE FUNCTION public.fn_notify_otc_trade_offer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'offered' THEN
    INSERT INTO public.notifications (user_id, category, title, body, target_path, target_tab, target_entity_type, target_entity_id, dedupe_key)
    VALUES (
      NEW.responder_user_id,
      'deal',
      'New OTC Trade Offer',
      'You received a trade offer for ' || NEW.amount || ' ' || NEW.currency,
      '/marketplace',
      'trades',
      'otc_trade',
      NEW.id::text,
      'otc_offer_' || NEW.id
    );
  END IF;
  RETURN NEW;
END;
$$;

-- 3. Update trade status notify with deep-link fields
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
    IF NEW.initiator_user_id = OLD.initiator_user_id THEN
      _notify_user_id := NEW.responder_user_id;
    ELSE
      _notify_user_id := NEW.initiator_user_id;
    END IF;

    _title := 'OTC Trade ' || initcap(NEW.status);
    _body := 'Trade for ' || NEW.amount || ' ' || NEW.currency || ' is now ' || NEW.status;

    INSERT INTO public.notifications (user_id, category, title, body, target_path, target_tab, target_entity_type, target_entity_id, dedupe_key)
    VALUES (
      _notify_user_id,
      'deal',
      _title,
      _body,
      '/marketplace',
      'trades',
      'otc_trade',
      NEW.id::text,
      'otc_status_' || NEW.id || '_' || NEW.status
    );
  END IF;
  RETURN NEW;
END;
$$;

-- 4. Add verification_tier to merchant_profiles
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'merchant_profiles' AND column_name = 'verification_tier') THEN
    ALTER TABLE public.merchant_profiles ADD COLUMN verification_tier text NOT NULL DEFAULT 'new';
  END IF;
END $$;

-- 5. Function to auto-calculate verification tier
CREATE OR REPLACE FUNCTION public.fn_refresh_verification_tier()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tier text;
BEGIN
  IF COALESCE(NEW.otc_completed_trades, 0) >= 50 AND COALESCE(NEW.otc_completion_rate, 0) >= 90 THEN
    _tier := 'verified';
  ELSIF COALESCE(NEW.otc_completed_trades, 0) >= 10 AND COALESCE(NEW.otc_completion_rate, 0) >= 70 THEN
    _tier := 'trusted';
  ELSE
    _tier := 'new';
  END IF;

  IF _tier IS DISTINCT FROM COALESCE(NEW.verification_tier, 'new') THEN
    NEW.verification_tier := _tier;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_refresh_verification_tier ON public.merchant_profiles;
CREATE TRIGGER trg_refresh_verification_tier
  BEFORE UPDATE ON public.merchant_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_refresh_verification_tier();
