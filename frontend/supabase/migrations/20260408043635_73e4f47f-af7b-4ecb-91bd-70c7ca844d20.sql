
-- ─── Settlement notification trigger ────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.notify_on_settlement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _rel RECORD;
  _settler_name TEXT;
  _partner_user_id UUID;
BEGIN
  -- Get relationship details
  SELECT merchant_a_id, merchant_b_id INTO _rel
  FROM public.merchant_relationships WHERE id = NEW.relationship_id;

  IF NOT FOUND THEN RETURN NEW; END IF;

  -- Get settler's display name
  SELECT display_name INTO _settler_name
  FROM public.merchant_profiles WHERE user_id = NEW.settled_by
  LIMIT 1;

  -- Determine partner user
  IF _rel.merchant_a_id = (SELECT merchant_id FROM public.merchant_profiles WHERE user_id = NEW.settled_by LIMIT 1) THEN
    SELECT user_id INTO _partner_user_id FROM public.merchant_profiles WHERE merchant_id = _rel.merchant_b_id LIMIT 1;
  ELSE
    SELECT user_id INTO _partner_user_id FROM public.merchant_profiles WHERE merchant_id = _rel.merchant_a_id LIMIT 1;
  END IF;

  IF _partner_user_id IS NULL OR _partner_user_id = NEW.settled_by THEN RETURN NEW; END IF;

  INSERT INTO public.notifications (
    user_id, category, title, body,
    entity_type, entity_id,
    actor_id,
    target_path, target_tab, target_focus,
    target_entity_type, target_entity_id
  ) VALUES (
    _partner_user_id, 'settlement',
    COALESCE(_settler_name, 'Partner') || ' submitted a settlement',
    NEW.amount || ' ' || NEW.currency,
    'settlement', NEW.id::text,
    NEW.settled_by,
    '/trading/orders', 'settlements', 'focusSettlementId',
    'settlement', NEW.id::text
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_settlement ON public.merchant_settlements;
CREATE TRIGGER trg_notify_settlement
  AFTER INSERT ON public.merchant_settlements
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_on_settlement();

-- ─── Capital transfer notification trigger ──────────────────────────────────

CREATE OR REPLACE FUNCTION public.notify_on_capital_transfer()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _rel RECORD;
  _actor_name TEXT;
  _partner_user_id UUID;
BEGIN
  SELECT merchant_a_id, merchant_b_id INTO _rel
  FROM public.merchant_relationships WHERE id = NEW.relationship_id;

  IF NOT FOUND THEN RETURN NEW; END IF;

  SELECT display_name INTO _actor_name
  FROM public.merchant_profiles WHERE user_id = NEW.transferred_by
  LIMIT 1;

  IF _rel.merchant_a_id = (SELECT merchant_id FROM public.merchant_profiles WHERE user_id = NEW.transferred_by LIMIT 1) THEN
    SELECT user_id INTO _partner_user_id FROM public.merchant_profiles WHERE merchant_id = _rel.merchant_b_id LIMIT 1;
  ELSE
    SELECT user_id INTO _partner_user_id FROM public.merchant_profiles WHERE merchant_id = _rel.merchant_a_id LIMIT 1;
  END IF;

  IF _partner_user_id IS NULL OR _partner_user_id = NEW.transferred_by THEN RETURN NEW; END IF;

  INSERT INTO public.notifications (
    user_id, category, title, body,
    entity_type, entity_id,
    actor_id,
    target_path, target_tab, target_focus,
    target_entity_type, target_entity_id
  ) VALUES (
    _partner_user_id, 'deal',
    COALESCE(_actor_name, 'Partner') || ' transferred ' || NEW.direction || ' capital',
    NEW.amount || ' ' || NEW.currency,
    'capital_transfer', NEW.id::text,
    NEW.transferred_by,
    '/trading/orders', 'transfers', 'focusTransferId',
    'capital_transfer', NEW.id::text
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_capital_transfer ON public.capital_transfers;
CREATE TRIGGER trg_notify_capital_transfer
  AFTER INSERT ON public.capital_transfers
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_on_capital_transfer();

-- ─── Profit record notification trigger ─────────────────────────────────────

CREATE OR REPLACE FUNCTION public.notify_on_profit_record()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _rel RECORD;
  _actor_name TEXT;
  _partner_user_id UUID;
BEGIN
  IF NEW.relationship_id IS NULL THEN RETURN NEW; END IF;

  SELECT merchant_a_id, merchant_b_id INTO _rel
  FROM public.merchant_relationships WHERE id = NEW.relationship_id;

  IF NOT FOUND THEN RETURN NEW; END IF;

  SELECT display_name INTO _actor_name
  FROM public.merchant_profiles WHERE user_id = NEW.recorded_by
  LIMIT 1;

  IF _rel.merchant_a_id = (SELECT merchant_id FROM public.merchant_profiles WHERE user_id = NEW.recorded_by LIMIT 1) THEN
    SELECT user_id INTO _partner_user_id FROM public.merchant_profiles WHERE merchant_id = _rel.merchant_b_id LIMIT 1;
  ELSE
    SELECT user_id INTO _partner_user_id FROM public.merchant_profiles WHERE merchant_id = _rel.merchant_a_id LIMIT 1;
  END IF;

  IF _partner_user_id IS NULL OR _partner_user_id = NEW.recorded_by THEN RETURN NEW; END IF;

  INSERT INTO public.notifications (
    user_id, category, title, body,
    entity_type, entity_id,
    actor_id,
    target_path, target_tab, target_focus,
    target_entity_type, target_entity_id
  ) VALUES (
    _partner_user_id, 'deal',
    COALESCE(_actor_name, 'Partner') || ' recorded profit',
    NEW.amount || ' ' || NEW.currency,
    'deal', NEW.deal_id::text,
    NEW.recorded_by,
    '/trading/orders', 'my', 'focusDealId',
    'deal', NEW.deal_id::text
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_profit_record ON public.merchant_profits;
CREATE TRIGGER trg_notify_profit_record
  AFTER INSERT ON public.merchant_profits
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_on_profit_record();
