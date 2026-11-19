-- USDT loan movements between connected merchants.
-- The proposer records a movement (sent / received) and it appears at once for
-- the other merchant, who approves or rejects it. Both trackers book the same
-- movement once it is approved; a rejection voids the proposer's copy.

CREATE TABLE IF NOT EXISTS public.merchant_loan_moves (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  relationship_id UUID NOT NULL REFERENCES public.merchant_relationships(id),
  proposer_merchant_id TEXT NOT NULL,
  responder_merchant_id TEXT NOT NULL,
  proposer_user_id UUID NOT NULL REFERENCES auth.users(id),
  responder_user_id UUID REFERENCES auth.users(id),
  -- From the proposer's side: 'out' = they sent USDT, 'in' = they received USDT.
  direction TEXT NOT NULL CHECK (direction IN ('out','in')),
  amount_usdt NUMERIC NOT NULL CHECK (amount_usdt > 0),
  moved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  note TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  responded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_loan_moves_proposer ON public.merchant_loan_moves (proposer_user_id);
CREATE INDEX IF NOT EXISTS idx_loan_moves_responder ON public.merchant_loan_moves (responder_user_id);

ALTER TABLE public.merchant_loan_moves ENABLE ROW LEVEL SECURITY;

-- Only the two participants can read; every write goes through the RPCs below.
CREATE POLICY "Participants can view loan moves"
  ON public.merchant_loan_moves FOR SELECT TO authenticated
  USING (proposer_user_id = auth.uid() OR responder_user_id = auth.uid());

CREATE TRIGGER trg_merchant_loan_moves_updated_at
  BEFORE UPDATE ON public.merchant_loan_moves
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER PUBLICATION supabase_realtime ADD TABLE public.merchant_loan_moves;

CREATE OR REPLACE FUNCTION public.create_merchant_loan_move(
  p_relationship_id UUID, p_direction TEXT, p_amount NUMERIC,
  p_moved_at TIMESTAMPTZ DEFAULT now(), p_note TEXT DEFAULT NULL
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _me TEXT := public.current_merchant_id();
  _rel public.merchant_relationships%ROWTYPE;
  _other TEXT; _other_user UUID; _id UUID;
BEGIN
  SELECT * INTO _rel FROM public.merchant_relationships WHERE id = p_relationship_id AND status = 'active';
  IF NOT FOUND OR _me IS NULL OR _me NOT IN (_rel.merchant_a_id, _rel.merchant_b_id) THEN
    RAISE EXCEPTION 'not a member of an active relationship';
  END IF;
  IF p_moved_at > now() + interval '5 minutes' THEN RAISE EXCEPTION 'date is in the future'; END IF;
  _other := CASE WHEN _rel.merchant_a_id = _me THEN _rel.merchant_b_id ELSE _rel.merchant_a_id END;
  SELECT user_id INTO _other_user FROM public.merchant_profiles WHERE merchant_id = _other LIMIT 1;
  INSERT INTO public.merchant_loan_moves
    (relationship_id, proposer_merchant_id, responder_merchant_id, proposer_user_id, responder_user_id,
     direction, amount_usdt, moved_at, note)
  VALUES (p_relationship_id, _me, _other, auth.uid(), _other_user, p_direction, p_amount, p_moved_at, p_note)
  RETURNING id INTO _id;
  RETURN _id;
END $$;

-- The other merchant approves or rejects. The proposer cannot answer their own request.
CREATE OR REPLACE FUNCTION public.respond_merchant_loan_move(p_move_id UUID, p_accept BOOLEAN)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _m public.merchant_loan_moves%ROWTYPE;
BEGIN
  SELECT * INTO _m FROM public.merchant_loan_moves WHERE id = p_move_id FOR UPDATE;
  IF NOT FOUND OR _m.responder_user_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'not allowed to respond'; END IF;
  IF _m.status <> 'pending' THEN RAISE EXCEPTION 'already answered'; END IF;
  UPDATE public.merchant_loan_moves
    SET status = CASE WHEN p_accept THEN 'approved' ELSE 'rejected' END, responded_at = now()
    WHERE id = p_move_id;
END $$;

-- The proposer withdraws a request that has not been answered yet.
CREATE OR REPLACE FUNCTION public.cancel_merchant_loan_move(p_move_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.merchant_loan_moves SET status = 'cancelled'
    WHERE id = p_move_id AND proposer_user_id = auth.uid() AND status = 'pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'cannot cancel'; END IF;
END $$;

-- Tell the other side the moment something is proposed or answered.
CREATE OR REPLACE FUNCTION public.fn_notify_loan_move()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _name TEXT; _to UUID; _title TEXT; _body TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    _to := NEW.responder_user_id;
    SELECT COALESCE(nickname, display_name, merchant_id) INTO _name FROM public.merchant_profiles WHERE merchant_id = NEW.proposer_merchant_id LIMIT 1;
    _title := COALESCE(_name, 'A merchant') || CASE WHEN NEW.direction = 'out' THEN ' sent you USDT' ELSE ' says you sent them USDT' END;
    _body := NEW.amount_usdt || ' USDT — approve or reject it in Loans';
  ELSIF NEW.status IN ('approved','rejected') AND OLD.status = 'pending' THEN
    _to := NEW.proposer_user_id;
    SELECT COALESCE(nickname, display_name, merchant_id) INTO _name FROM public.merchant_profiles WHERE merchant_id = NEW.responder_merchant_id LIMIT 1;
    _title := COALESCE(_name, 'A merchant') || CASE WHEN NEW.status = 'approved' THEN ' approved your loan movement' ELSE ' rejected your loan movement' END;
    _body := NEW.amount_usdt || ' USDT';
  ELSE
    RETURN NEW;
  END IF;
  IF _to IS NULL THEN RETURN NEW; END IF;
  INSERT INTO public.notifications (user_id, category, title, body, entity_type, entity_id)
  VALUES (_to, 'message', _title, _body, 'merchant_loan_move', NEW.id::text);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_notify_loan_move ON public.merchant_loan_moves;
CREATE TRIGGER trg_notify_loan_move
  AFTER INSERT OR UPDATE ON public.merchant_loan_moves
  FOR EACH ROW EXECUTE FUNCTION public.fn_notify_loan_move();

REVOKE ALL ON FUNCTION public.create_merchant_loan_move(UUID, TEXT, NUMERIC, TIMESTAMPTZ, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.respond_merchant_loan_move(UUID, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_merchant_loan_move(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_merchant_loan_move(UUID, TEXT, NUMERIC, TIMESTAMPTZ, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.respond_merchant_loan_move(UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_merchant_loan_move(UUID) TO authenticated;
