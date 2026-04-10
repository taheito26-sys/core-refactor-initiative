
CREATE OR REPLACE FUNCTION public.fn_notify_otc_trade()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _recipient_id uuid;
  _title text;
  _body text;
  _actor_id uuid;
BEGIN
  -- Determine recipient (the OTHER party) and message
  IF TG_OP = 'INSERT' THEN
    -- New offer → notify the responder (listing owner)
    _recipient_id := NEW.responder_user_id;
    _actor_id := NEW.initiator_user_id;
    _title := 'New OTC Offer';
    _body := 'You received a new trade offer for ' || NEW.amount || ' ' || NEW.currency;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Status changed
    IF NEW.status = OLD.status THEN
      RETURN NEW; -- No status change, skip
    END IF;
    
    CASE NEW.status
      WHEN 'countered' THEN
        -- Counter came from responder → notify initiator
        _recipient_id := NEW.initiator_user_id;
        _actor_id := NEW.responder_user_id;
        _title := 'Counter Offer Received';
        _body := 'Your trade offer was countered: ' || COALESCE(NEW.counter_amount::text, '') || ' @ ' || COALESCE(NEW.counter_rate::text, '');
      WHEN 'confirmed' THEN
        -- Could be either party confirming
        -- The one who DIDN'T update should get notified
        -- We approximate: if status was 'offered', responder confirmed → notify initiator
        -- if status was 'countered', initiator confirmed → notify responder
        IF OLD.status = 'offered' THEN
          _recipient_id := NEW.initiator_user_id;
          _actor_id := NEW.responder_user_id;
        ELSE
          _recipient_id := NEW.responder_user_id;
          _actor_id := NEW.initiator_user_id;
        END IF;
        _title := 'Trade Confirmed ✅';
        _body := 'Your OTC trade for ' || COALESCE(NEW.counter_amount, NEW.amount) || ' ' || NEW.currency || ' has been confirmed';
      WHEN 'completed' THEN
        -- Notify both but skip the actor (we don't know who, so notify both)
        -- We'll notify the responder; the UI handles the rest
        _recipient_id := CASE 
          WHEN NEW.initiator_user_id != COALESCE(NEW.responder_user_id, NEW.initiator_user_id) 
          THEN NEW.responder_user_id 
          ELSE NEW.initiator_user_id 
        END;
        _actor_id := CASE WHEN _recipient_id = NEW.responder_user_id THEN NEW.initiator_user_id ELSE NEW.responder_user_id END;
        _title := 'Trade Completed 🎉';
        _body := 'OTC trade for ' || COALESCE(NEW.counter_amount, NEW.amount) || ' ' || NEW.currency || ' marked as completed';
      WHEN 'cancelled' THEN
        -- Notify the other party
        -- We approximate: notify responder if initiator cancelled, vice versa
        _recipient_id := NEW.responder_user_id;
        _actor_id := NEW.initiator_user_id;
        _title := 'Trade Cancelled';
        _body := 'An OTC trade for ' || NEW.amount || ' ' || NEW.currency || ' was cancelled';
      ELSE
        RETURN NEW;
    END CASE;
  ELSE
    RETURN NEW;
  END IF;

  -- Don't notify yourself
  IF _recipient_id = _actor_id THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.notifications (
    user_id, category, title, body,
    entity_type, entity_id,
    actor_id, target_path, target_tab,
    dedupe_key
  ) VALUES (
    _recipient_id, 'deal', _title, _body,
    'otc_trade', NEW.id::text,
    _actor_id, '/marketplace', 'trades',
    'otc_trade_' || NEW.id::text || '_' || NEW.status
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_otc_trade ON public.otc_trades;
CREATE TRIGGER trg_notify_otc_trade
  AFTER INSERT OR UPDATE ON public.otc_trades
  FOR EACH ROW EXECUTE FUNCTION public.fn_notify_otc_trade();
