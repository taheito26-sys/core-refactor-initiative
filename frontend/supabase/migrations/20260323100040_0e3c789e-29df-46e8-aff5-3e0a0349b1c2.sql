
-- Create a trigger function that inserts a notification for the recipient when a message is sent
CREATE OR REPLACE FUNCTION public.notify_on_new_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _rel RECORD;
  _sender_merchant_id TEXT;
  _recipient_merchant_id TEXT;
  _recipient_user_id UUID;
  _sender_name TEXT;
BEGIN
  -- Get the relationship
  SELECT merchant_a_id, merchant_b_id INTO _rel
  FROM public.merchant_relationships
  WHERE id = NEW.relationship_id;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  -- Find sender's merchant_id
  SELECT merchant_id INTO _sender_merchant_id
  FROM public.merchant_profiles
  WHERE user_id = NEW.sender_id
  LIMIT 1;

  -- Determine recipient merchant_id
  IF _sender_merchant_id = _rel.merchant_a_id THEN
    _recipient_merchant_id := _rel.merchant_b_id;
  ELSE
    _recipient_merchant_id := _rel.merchant_a_id;
  END IF;

  -- Get recipient user_id and sender display name
  SELECT user_id INTO _recipient_user_id
  FROM public.merchant_profiles
  WHERE merchant_id = _recipient_merchant_id
  LIMIT 1;

  SELECT display_name INTO _sender_name
  FROM public.merchant_profiles
  WHERE merchant_id = _sender_merchant_id
  LIMIT 1;

  IF _recipient_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Insert notification for recipient
  INSERT INTO public.notifications (user_id, title, body, category)
  VALUES (
    _recipient_user_id,
    'New message from ' || COALESCE(_sender_name, 'Unknown'),
    LEFT(NEW.content, 100),
    'message'
  );

  RETURN NEW;
END;
$$;

-- Create the trigger
CREATE TRIGGER trg_notify_on_new_message
  AFTER INSERT ON public.merchant_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_on_new_message();
