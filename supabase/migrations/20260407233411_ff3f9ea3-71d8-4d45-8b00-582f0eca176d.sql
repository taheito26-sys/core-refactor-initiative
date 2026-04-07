
-- Fix custody notification trigger: use category 'stock' with proper target fields instead of 'message'
CREATE OR REPLACE FUNCTION public.fn_notify_cash_custody_request()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _requester_name TEXT; _recipient_user_id UUID;
BEGIN
  _recipient_user_id := NEW.custodian_user_id;
  IF _recipient_user_id IS NULL THEN RETURN NEW; END IF;
  SELECT COALESCE(nickname, display_name, merchant_id) INTO _requester_name
  FROM public.merchant_profiles WHERE merchant_id = NEW.requester_merchant_id LIMIT 1;
  INSERT INTO public.notifications (user_id, category, title, body, entity_type, entity_id, target_path, target_tab, target_focus, target_entity_type, target_entity_id)
  VALUES (_recipient_user_id, 'stock',
    COALESCE(_requester_name, 'A merchant') || ' sent you a cash custody request',
    'Amount: ' || NEW.amount || ' ' || NEW.currency || COALESCE(' — ' || NEW.note, ''),
    'cash_custody', NEW.id::text,
    '/trading/stock', 'cash', 'focusCustodyId', 'cash_custody', NEW.id::text);
  RETURN NEW;
END;
$$;
