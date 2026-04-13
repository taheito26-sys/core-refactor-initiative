
CREATE OR REPLACE FUNCTION public.notify_merchant_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _rel RECORD;
  _sender_name TEXT;
  _recipient_merchant_id TEXT;
  _recipient_user_id UUID;
  _sender_merchant_id TEXT;
BEGIN
  -- Get relationship members
  SELECT merchant_a_id, merchant_b_id INTO _rel
  FROM public.merchant_relationships
  WHERE id = NEW.relationship_id;

  IF NOT FOUND THEN RETURN NEW; END IF;

  -- Get sender merchant_id
  SELECT merchant_id INTO _sender_merchant_id
  FROM public.merchant_profiles
  WHERE user_id = NEW.sender_id;

  -- Get sender display name
  SELECT display_name INTO _sender_name
  FROM public.merchant_profiles
  WHERE user_id = NEW.sender_id;

  _sender_name := COALESCE(_sender_name, 'Someone');

  -- Determine recipient merchant_id (the one who is NOT the sender)
  IF _sender_merchant_id = _rel.merchant_a_id THEN
    _recipient_merchant_id := _rel.merchant_b_id;
  ELSE
    _recipient_merchant_id := _rel.merchant_a_id;
  END IF;

  -- Get recipient user_id
  SELECT user_id INTO _recipient_user_id
  FROM public.merchant_profiles
  WHERE merchant_id = _recipient_merchant_id;

  IF _recipient_user_id IS NULL THEN RETURN NEW; END IF;

  -- Insert notification for recipient
  INSERT INTO public.notifications (user_id, title, body, category)
  VALUES (
    _recipient_user_id,
    _sender_name || ' sent you a message',
    LEFT(NEW.content, 100),
    'message'
  );

  RETURN NEW;
END;
$$;

-- Create the trigger
CREATE TRIGGER trg_notify_merchant_message
AFTER INSERT ON public.merchant_messages
FOR EACH ROW
EXECUTE FUNCTION public.notify_merchant_message();
