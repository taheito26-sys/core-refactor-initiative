
-- Trigger function: notify on new invite (INSERT)
CREATE OR REPLACE FUNCTION public.notify_on_new_invite()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE
  _sender_name TEXT;
  _recipient_user_id UUID;
BEGIN
  -- Get sender display name
  SELECT display_name INTO _sender_name
  FROM public.merchant_profiles
  WHERE merchant_id = NEW.from_merchant_id
  LIMIT 1;

  _sender_name := COALESCE(_sender_name, 'A merchant');

  -- Get recipient user_id
  SELECT user_id INTO _recipient_user_id
  FROM public.merchant_profiles
  WHERE merchant_id = NEW.to_merchant_id
  LIMIT 1;

  IF _recipient_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Insert urgent invite notification
  INSERT INTO public.notifications (user_id, title, body, category)
  VALUES (
    _recipient_user_id,
    '🔔 ' || _sender_name || ' sent you an invite',
    COALESCE(NEW.message, 'You have a new connection request'),
    'invite'
  );

  RETURN NEW;
END;
$function$;

-- Create trigger on merchant_invites INSERT
CREATE TRIGGER on_new_invite_notification
  AFTER INSERT ON public.merchant_invites
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_on_new_invite();

-- Also notify when invite is accepted/rejected (status change)
CREATE OR REPLACE FUNCTION public.notify_on_invite_status_change()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE
  _actor_name TEXT;
  _notify_user_id UUID;
  _actor_merchant_id TEXT;
  _target_merchant_id TEXT;
  _title TEXT;
  _body TEXT;
BEGIN
  -- Only fire on status change
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'accepted' THEN
    -- Notify the sender that their invite was accepted
    _actor_merchant_id := NEW.to_merchant_id;
    _target_merchant_id := NEW.from_merchant_id;

    SELECT display_name INTO _actor_name
    FROM public.merchant_profiles WHERE merchant_id = _actor_merchant_id LIMIT 1;

    SELECT user_id INTO _notify_user_id
    FROM public.merchant_profiles WHERE merchant_id = _target_merchant_id LIMIT 1;

    _title := '✅ ' || COALESCE(_actor_name, 'A merchant') || ' accepted your invite';
    _body := 'You are now connected. Start collaborating!';

  ELSIF NEW.status = 'rejected' THEN
    _actor_merchant_id := NEW.to_merchant_id;
    _target_merchant_id := NEW.from_merchant_id;

    SELECT display_name INTO _actor_name
    FROM public.merchant_profiles WHERE merchant_id = _actor_merchant_id LIMIT 1;

    SELECT user_id INTO _notify_user_id
    FROM public.merchant_profiles WHERE merchant_id = _target_merchant_id LIMIT 1;

    _title := '❌ ' || COALESCE(_actor_name, 'A merchant') || ' declined your invite';
    _body := 'Your connection request was not accepted.';

  ELSE
    RETURN NEW;
  END IF;

  IF _notify_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.notifications (user_id, title, body, category)
  VALUES (_notify_user_id, _title, _body, 'invite');

  RETURN NEW;
END;
$function$;

CREATE TRIGGER on_invite_status_change_notification
  AFTER UPDATE ON public.merchant_invites
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_on_invite_status_change();
