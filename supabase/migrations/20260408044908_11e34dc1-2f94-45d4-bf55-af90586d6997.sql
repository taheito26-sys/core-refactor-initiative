-- ════════════════════════════════════════════════════════════════════
-- 1. Customer Order notification trigger
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.notify_customer_order_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _merchant_user_id uuid;
  _customer_name text;
BEGIN
  -- Get the merchant's user_id
  SELECT mp.user_id INTO _merchant_user_id
  FROM merchant_profiles mp
  WHERE mp.merchant_id = NEW.merchant_id
  LIMIT 1;

  IF _merchant_user_id IS NULL OR _merchant_user_id = NEW.customer_user_id THEN
    RETURN NEW;
  END IF;

  -- Get customer display name
  SELECT cp.display_name INTO _customer_name
  FROM customer_profiles cp
  WHERE cp.user_id = NEW.customer_user_id
  LIMIT 1;

  INSERT INTO public.notifications (
    user_id, category, title, body,
    target_path, target_tab, target_entity_type, target_entity_id,
    actor_id
  ) VALUES (
    _merchant_user_id,
    'order',
    COALESCE(_customer_name, 'A customer') || ' placed a ' || NEW.order_type || ' order',
    NEW.amount || ' ' || NEW.currency,
    '/merchants', 'customer-orders', 'customer_order', NEW.id::text,
    NEW.customer_user_id
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_customer_order ON public.customer_orders;
CREATE TRIGGER trg_notify_customer_order
  AFTER INSERT ON public.customer_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_customer_order_created();

-- ════════════════════════════════════════════════════════════════════
-- 2. Cash Custody Request notification trigger
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.notify_cash_custody_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _custodian_user_id uuid;
  _requester_name text;
BEGIN
  -- Resolve custodian user id
  IF NEW.custodian_user_id IS NOT NULL THEN
    _custodian_user_id := NEW.custodian_user_id;
  ELSE
    SELECT mp.user_id INTO _custodian_user_id
    FROM merchant_profiles mp
    WHERE mp.merchant_id = NEW.custodian_merchant_id
    LIMIT 1;
  END IF;

  IF _custodian_user_id IS NULL THEN RETURN NEW; END IF;
  -- Suppress self-notification
  IF _custodian_user_id = COALESCE(NEW.requester_user_id, '00000000-0000-0000-0000-000000000000'::uuid) THEN
    RETURN NEW;
  END IF;

  -- Requester name
  SELECT mp.display_name INTO _requester_name
  FROM merchant_profiles mp
  WHERE mp.merchant_id = NEW.requester_merchant_id
  LIMIT 1;

  INSERT INTO public.notifications (
    user_id, category, title, body,
    target_path, target_entity_type, target_entity_id,
    actor_id
  ) VALUES (
    _custodian_user_id,
    'deal',
    COALESCE(_requester_name, 'A merchant') || ' requested cash custody',
    NEW.amount || ' ' || NEW.currency || CASE WHEN NEW.note IS NOT NULL THEN ' — ' || LEFT(NEW.note, 50) ELSE '' END,
    '/stock', 'cash_custody', NEW.id::text,
    NEW.requester_user_id
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_cash_custody ON public.cash_custody_requests;
CREATE TRIGGER trg_notify_cash_custody
  AFTER INSERT ON public.cash_custody_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_cash_custody_request();

-- ════════════════════════════════════════════════════════════════════
-- 3. Capital Pool (deal_capital_ledger) notification trigger
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.notify_capital_ledger_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _partner_user_id uuid;
  _initiator_name text;
  _rel record;
BEGIN
  -- Get the relationship to find the counterparty
  SELECT mr.merchant_a_id, mr.merchant_b_id INTO _rel
  FROM merchant_relationships mr
  WHERE mr.id = NEW.relationship_id;

  IF _rel IS NULL THEN RETURN NEW; END IF;

  -- Find the initiator's merchant_id
  DECLARE
    _initiator_merchant text;
    _partner_merchant text;
  BEGIN
    SELECT mp.merchant_id INTO _initiator_merchant
    FROM merchant_profiles mp
    WHERE mp.user_id = NEW.initiated_by
    LIMIT 1;

    -- Partner is the other side
    IF _initiator_merchant = _rel.merchant_a_id THEN
      _partner_merchant := _rel.merchant_b_id;
    ELSE
      _partner_merchant := _rel.merchant_a_id;
    END IF;

    SELECT mp.user_id INTO _partner_user_id
    FROM merchant_profiles mp
    WHERE mp.merchant_id = _partner_merchant
    LIMIT 1;

    SELECT mp.display_name INTO _initiator_name
    FROM merchant_profiles mp
    WHERE mp.merchant_id = _initiator_merchant
    LIMIT 1;
  END;

  IF _partner_user_id IS NULL THEN RETURN NEW; END IF;

  INSERT INTO public.notifications (
    user_id, category, title, body,
    target_path, target_tab, target_entity_type, target_entity_id,
    actor_id
  ) VALUES (
    _partner_user_id,
    'deal',
    COALESCE(_initiator_name, 'Partner') || ' ' || CASE
      WHEN NEW.type = 'contribution' THEN 'added capital'
      WHEN NEW.type = 'withdrawal' THEN 'withdrew capital'
      WHEN NEW.type = 'reinvestment' THEN 'reinvested profits'
      ELSE 'updated capital pool'
    END,
    NEW.amount || ' ' || NEW.currency || ' — Pool balance: ' || NEW.pool_balance_after,
    '/merchants', 'capital', 'capital_ledger', NEW.id::text,
    NEW.initiated_by
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_capital_ledger ON public.deal_capital_ledger;
CREATE TRIGGER trg_notify_capital_ledger
  AFTER INSERT ON public.deal_capital_ledger
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_capital_ledger_change();