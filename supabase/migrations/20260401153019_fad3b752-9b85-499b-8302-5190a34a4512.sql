-- Add precise routing columns to notifications
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS actor_id uuid NULL,
  ADD COLUMN IF NOT EXISTS target_path text NULL,
  ADD COLUMN IF NOT EXISTS target_tab text NULL,
  ADD COLUMN IF NOT EXISTS target_focus text NULL,
  ADD COLUMN IF NOT EXISTS target_entity_type text NULL,
  ADD COLUMN IF NOT EXISTS target_entity_id text NULL;

-- Constrain target_tab to valid values
ALTER TABLE public.notifications
  ADD CONSTRAINT chk_notifications_target_tab
  CHECK (target_tab IS NULL OR target_tab IN ('my', 'incoming', 'outgoing', 'transfers'));

-- Index for actor_id filtering
CREATE INDEX IF NOT EXISTS idx_notifications_actor_id ON public.notifications (actor_id);

-- ============================================================
-- Update notify_merchant_deal_change to use precise targeting
-- and exclude actor from recipients
-- ============================================================
CREATE OR REPLACE FUNCTION public.notify_merchant_deal_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _rel RECORD;
  _creator_name TEXT;
  _partner_merchant_id TEXT;
  _partner_user_id UUID;
  _creator_user_id UUID;
  _title TEXT;
  _body TEXT;
  _actor_id UUID;
  _recipient_tab TEXT;
BEGIN
  SELECT merchant_a_id, merchant_b_id INTO _rel
  FROM public.merchant_relationships
  WHERE id = NEW.relationship_id;

  IF NOT FOUND THEN RETURN NEW; END IF;

  SELECT display_name INTO _creator_name
  FROM public.merchant_profiles
  WHERE user_id = NEW.created_by;

  _creator_name := COALESCE(_creator_name, 'A partner');

  IF EXISTS (SELECT 1 FROM public.merchant_profiles WHERE merchant_id = _rel.merchant_a_id AND user_id = NEW.created_by) THEN
    _partner_merchant_id := _rel.merchant_b_id;
  ELSE
    _partner_merchant_id := _rel.merchant_a_id;
  END IF;

  SELECT user_id INTO _partner_user_id
  FROM public.merchant_profiles
  WHERE merchant_id = _partner_merchant_id;

  IF _partner_user_id IS NULL THEN RETURN NEW; END IF;

  -- INSERT: new deal created → notify the partner (NOT the creator)
  IF TG_OP = 'INSERT' THEN
    _title := _creator_name || ' sent you a new deal';
    _body := NEW.title || ' — ' || NEW.amount || ' ' || NEW.currency;
    _actor_id := NEW.created_by;
    -- Partner receives this as incoming
    _recipient_tab := 'incoming';

    INSERT INTO public.notifications (
      user_id, title, body, category,
      actor_id, target_path, target_tab, target_focus, target_entity_type, target_entity_id,
      entity_type, entity_id
    )
    VALUES (
      _partner_user_id, _title, _body, 'deal',
      _actor_id, '/trading/orders', _recipient_tab, 'focusDealId', 'deal', NEW.id::text,
      'deal', NEW.id::text
    );

  -- UPDATE: status changed → notify both parties EXCEPT the one who changed it
  ELSIF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    _title := 'Deal "' || NEW.title || '" ' || NEW.status;
    _body := 'Status changed from ' || OLD.status || ' to ' || NEW.status;
    -- We don't know exactly who triggered the update, so we use auth.uid() as actor
    _actor_id := auth.uid();

    -- Notify the deal creator if they are NOT the actor
    IF NEW.created_by IS DISTINCT FROM _actor_id THEN
      INSERT INTO public.notifications (
        user_id, title, body, category,
        actor_id, target_path, target_tab, target_focus, target_entity_type, target_entity_id,
        entity_type, entity_id
      )
      VALUES (
        NEW.created_by, _title, _body, 'deal',
        _actor_id, '/trading/orders', 'outgoing', 'focusDealId', 'deal', NEW.id::text,
        'deal', NEW.id::text
      );
    END IF;

    -- Notify the partner if they are NOT the actor
    IF _partner_user_id IS DISTINCT FROM _actor_id THEN
      INSERT INTO public.notifications (
        user_id, title, body, category,
        actor_id, target_path, target_tab, target_focus, target_entity_type, target_entity_id,
        entity_type, entity_id
      )
      VALUES (
        _partner_user_id, _title, _body, 'deal',
        _actor_id, '/trading/orders', 'incoming', 'focusDealId', 'deal', NEW.id::text,
        'deal', NEW.id::text
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- ============================================================
-- Update notify_on_new_message to populate target fields
-- ============================================================
CREATE OR REPLACE FUNCTION public.notify_on_new_message()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _rel RECORD;
  _sender_merchant_id TEXT;
  _recipient_merchant_id TEXT;
  _recipient_user_id UUID;
  _sender_name TEXT;
BEGIN
  SELECT merchant_a_id, merchant_b_id INTO _rel
  FROM public.merchant_relationships
  WHERE id = NEW.relationship_id;

  IF NOT FOUND THEN RETURN NEW; END IF;

  SELECT merchant_id INTO _sender_merchant_id
  FROM public.merchant_profiles
  WHERE user_id = NEW.sender_id LIMIT 1;

  IF _sender_merchant_id = _rel.merchant_a_id THEN
    _recipient_merchant_id := _rel.merchant_b_id;
  ELSE
    _recipient_merchant_id := _rel.merchant_a_id;
  END IF;

  SELECT user_id INTO _recipient_user_id
  FROM public.merchant_profiles
  WHERE merchant_id = _recipient_merchant_id LIMIT 1;

  SELECT COALESCE(nickname, display_name, merchant_id) INTO _sender_name
  FROM public.merchant_profiles
  WHERE user_id = NEW.sender_id LIMIT 1;

  IF _recipient_user_id IS NULL THEN RETURN NEW; END IF;

  INSERT INTO public.notifications (
    user_id, category, title, body, conversation_id, message_id,
    actor_id, target_path, target_entity_type, target_entity_id
  )
  VALUES (
    _recipient_user_id,
    'message',
    COALESCE(_sender_name, 'Unknown'),
    LEFT(NEW.content, 100),
    NEW.relationship_id,
    NEW.id,
    NEW.sender_id,
    '/chat',
    'message',
    NEW.id::text
  );

  RETURN NEW;
END;
$function$;

-- ============================================================
-- Update os_send_notification to populate actor_id
-- ============================================================
CREATE OR REPLACE FUNCTION public.os_send_notification(_room_id uuid, _message_id uuid, _urgency text DEFAULT 'normal'::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _msg RECORD;
  _sender_name TEXT;
  _sender_user_id UUID;
  _count integer := 0;
  _member RECORD;
  _user_id uuid;
BEGIN
  SELECT sender_merchant_id, content INTO _msg
  FROM public.os_messages WHERE id = _message_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  SELECT COALESCE(nickname, display_name, merchant_id) INTO _sender_name
  FROM public.merchant_profiles WHERE merchant_id = _msg.sender_merchant_id LIMIT 1;

  SELECT mp.user_id INTO _sender_user_id
  FROM public.merchant_profiles mp WHERE mp.merchant_id = _msg.sender_merchant_id LIMIT 1;

  FOR _member IN
    SELECT rm.merchant_id FROM public.os_room_members rm
    WHERE rm.room_id = _room_id AND rm.merchant_id != _msg.sender_merchant_id
  LOOP
    SELECT mp.user_id INTO _user_id
    FROM public.merchant_profiles mp WHERE mp.merchant_id = _member.merchant_id LIMIT 1;

    IF _user_id IS NOT NULL THEN
      INSERT INTO public.notifications (
        user_id, category, title, body, entity_type, entity_id, anchor_id,
        actor_id, target_path, target_entity_type, target_entity_id
      )
      VALUES (
        _user_id, 'message', COALESCE(_sender_name, 'Unknown'),
        LEFT(_msg.content, 100), 'os_room', _room_id::text, _message_id::text,
        _sender_user_id, '/chat', 'os_room', _room_id::text
      );
      _count := _count + 1;
    END IF;
  END LOOP;

  RETURN _count;
END;
$function$;

-- ============================================================
-- Update notify_on_new_invite to populate target fields
-- ============================================================
CREATE OR REPLACE FUNCTION public.notify_on_new_invite()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _sender_name TEXT;
  _sender_user_id UUID;
  _recipient_user_id UUID;
BEGIN
  SELECT display_name, user_id INTO _sender_name, _sender_user_id
  FROM public.merchant_profiles
  WHERE merchant_id = NEW.from_merchant_id
  LIMIT 1;

  _sender_name := COALESCE(_sender_name, 'A merchant');

  SELECT user_id INTO _recipient_user_id
  FROM public.merchant_profiles
  WHERE merchant_id = NEW.to_merchant_id
  LIMIT 1;

  IF _recipient_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.notifications (
    user_id, title, body, category,
    actor_id, target_path, target_entity_type, target_entity_id
  )
  VALUES (
    _recipient_user_id,
    '🔔 ' || _sender_name || ' sent you an invite',
    COALESCE(NEW.message, 'You have a new connection request'),
    'invite',
    _sender_user_id,
    '/merchants',
    'invite',
    NEW.id::text
  );

  RETURN NEW;
END;
$function$;

-- ============================================================
-- Update notify_on_invite_status_change to populate target fields
-- ============================================================
CREATE OR REPLACE FUNCTION public.notify_on_invite_status_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _actor_name TEXT;
  _actor_user_id UUID;
  _notify_user_id UUID;
  _actor_merchant_id TEXT;
  _target_merchant_id TEXT;
  _title TEXT;
  _body TEXT;
BEGIN
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'accepted' THEN
    _actor_merchant_id := NEW.to_merchant_id;
    _target_merchant_id := NEW.from_merchant_id;

    SELECT display_name, user_id INTO _actor_name, _actor_user_id
    FROM public.merchant_profiles WHERE merchant_id = _actor_merchant_id LIMIT 1;

    SELECT user_id INTO _notify_user_id
    FROM public.merchant_profiles WHERE merchant_id = _target_merchant_id LIMIT 1;

    _title := '✅ ' || COALESCE(_actor_name, 'A merchant') || ' accepted your invite';
    _body := 'You are now connected. Start collaborating!';

  ELSIF NEW.status = 'rejected' THEN
    _actor_merchant_id := NEW.to_merchant_id;
    _target_merchant_id := NEW.from_merchant_id;

    SELECT display_name, user_id INTO _actor_name, _actor_user_id
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

  INSERT INTO public.notifications (
    user_id, title, body, category,
    actor_id, target_path, target_entity_type, target_entity_id
  )
  VALUES (
    _notify_user_id, _title, _body, 'invite',
    _actor_user_id, '/merchants', 'invite', NEW.id::text
  );

  RETURN NEW;
END;
$function$;