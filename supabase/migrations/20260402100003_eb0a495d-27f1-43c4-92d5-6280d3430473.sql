
CREATE OR REPLACE FUNCTION public.notify_on_new_agreement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _rel RECORD;
  _creator_merchant_id TEXT;
  _partner_merchant_id TEXT;
  _partner_user_id UUID;
  _creator_name TEXT;
  _title TEXT;
  _body TEXT;
  _agg_type TEXT;
BEGIN
  -- Only fire on INSERT
  IF TG_OP != 'INSERT' THEN RETURN NEW; END IF;

  -- Get the relationship
  SELECT merchant_a_id, merchant_b_id INTO _rel
  FROM public.merchant_relationships
  WHERE id = NEW.relationship_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  -- Get the creator's merchant_id
  SELECT merchant_id INTO _creator_merchant_id
  FROM public.merchant_profiles
  WHERE user_id = NEW.created_by LIMIT 1;

  -- Determine who the partner is
  IF _creator_merchant_id = _rel.merchant_a_id THEN
    _partner_merchant_id := _rel.merchant_b_id;
  ELSE
    _partner_merchant_id := _rel.merchant_a_id;
  END IF;

  -- Get partner user_id
  SELECT user_id INTO _partner_user_id
  FROM public.merchant_profiles
  WHERE merchant_id = _partner_merchant_id LIMIT 1;

  IF _partner_user_id IS NULL THEN RETURN NEW; END IF;

  -- Get creator display name
  SELECT COALESCE(nickname, display_name, merchant_id) INTO _creator_name
  FROM public.merchant_profiles
  WHERE user_id = NEW.created_by LIMIT 1;

  _agg_type := CASE
    WHEN NEW.agreement_type = 'operator_priority' THEN 'Operator Priority'
    ELSE 'Standard'
  END;

  _title := _creator_name || ' sent you a new agreement';
  _body := _agg_type || ' Profit Share · ' || NEW.settlement_cadence || ' settlement';

  INSERT INTO public.notifications (
    user_id, title, body, category,
    actor_id, target_path, target_entity_type, target_entity_id,
    entity_type, entity_id
  )
  VALUES (
    _partner_user_id, _title, _body, 'agreement',
    NEW.created_by, '/merchants', 'agreement', NEW.id::text,
    'agreement', NEW.id::text
  );

  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_notify_new_agreement
AFTER INSERT ON public.profit_share_agreements
FOR EACH ROW
EXECUTE FUNCTION public.notify_on_new_agreement();
