
CREATE OR REPLACE FUNCTION public.notify_merchant_deal_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _rel RECORD;
  _creator_name TEXT;
  _partner_merchant_id TEXT;
  _partner_user_id UUID;
  _title TEXT;
  _body TEXT;
BEGIN
  -- Get relationship members
  SELECT merchant_a_id, merchant_b_id INTO _rel
  FROM public.merchant_relationships
  WHERE id = NEW.relationship_id;

  IF NOT FOUND THEN RETURN NEW; END IF;

  -- Get creator display name
  SELECT display_name INTO _creator_name
  FROM public.merchant_profiles
  WHERE user_id = NEW.created_by;

  _creator_name := COALESCE(_creator_name, 'A partner');

  -- Determine partner merchant_id (the one who is NOT the creator)
  IF EXISTS (SELECT 1 FROM public.merchant_profiles WHERE merchant_id = _rel.merchant_a_id AND user_id = NEW.created_by) THEN
    _partner_merchant_id := _rel.merchant_b_id;
  ELSE
    _partner_merchant_id := _rel.merchant_a_id;
  END IF;

  -- Get partner user_id
  SELECT user_id INTO _partner_user_id
  FROM public.merchant_profiles
  WHERE merchant_id = _partner_merchant_id;

  IF _partner_user_id IS NULL THEN RETURN NEW; END IF;

  -- INSERT: new deal created → notify the partner
  IF TG_OP = 'INSERT' THEN
    _title := _creator_name || ' sent you a new deal';
    _body := NEW.title || ' — ' || NEW.amount || ' ' || NEW.currency;

    INSERT INTO public.notifications (user_id, title, body, category)
    VALUES (_partner_user_id, _title, _body, 'deal');

  -- UPDATE: status changed → notify the OTHER party
  ELSIF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    -- On status change, notify the creator (since the partner is the one changing status)
    -- But we need to figure out WHO made the change; for now notify the creator
    _title := 'Deal "' || NEW.title || '" ' || NEW.status;
    _body := 'Status changed from ' || OLD.status || ' to ' || NEW.status;

    -- Notify the deal creator when partner changes status
    INSERT INTO public.notifications (user_id, title, body, category)
    VALUES (NEW.created_by, _title, _body, 'deal');

    -- Also notify the partner when creator changes status
    INSERT INTO public.notifications (user_id, title, body, category)
    VALUES (_partner_user_id, _title, _body, 'deal');
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_merchant_deal
AFTER INSERT OR UPDATE ON public.merchant_deals
FOR EACH ROW
EXECUTE FUNCTION public.notify_merchant_deal_change();
