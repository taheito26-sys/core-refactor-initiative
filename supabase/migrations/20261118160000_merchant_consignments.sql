-- USDT consignments: merchant A sends USDT to linked merchant B to sell.
-- Each side reports what happened (sold / returned unsold / new purchase) and
-- the other side confirms, so both trackers book the same numbers.

CREATE TABLE IF NOT EXISTS public.merchant_consignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  relationship_id UUID NOT NULL REFERENCES public.merchant_relationships(id),
  sender_merchant_id TEXT NOT NULL,
  receiver_merchant_id TEXT NOT NULL,
  sender_user_id UUID NOT NULL REFERENCES auth.users(id),
  receiver_user_id UUID REFERENCES auth.users(id),
  qty_usdt NUMERIC NOT NULL CHECK (qty_usdt > 0),
  base_price_qar NUMERIC NOT NULL CHECK (base_price_qar > 0),
  sender_share_pct NUMERIC NOT NULL DEFAULT 50 CHECK (sender_share_pct BETWEEN 0 AND 100),
  tracker_ref TEXT,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.merchant_consignment_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consignment_id UUID NOT NULL REFERENCES public.merchant_consignments(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('sale','return','purchase')),
  qty_usdt NUMERIC NOT NULL CHECK (qty_usdt > 0),
  price_qar NUMERIC,
  reported_by UUID NOT NULL REFERENCES auth.users(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','rejected')),
  note TEXT,
  responded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- A sale and a purchase carry a price; a return never does.
  CHECK ((kind = 'return' AND price_qar IS NULL) OR (kind <> 'return' AND price_qar > 0))
);

CREATE INDEX IF NOT EXISTS idx_consignments_sender ON public.merchant_consignments (sender_user_id);
CREATE INDEX IF NOT EXISTS idx_consignments_receiver ON public.merchant_consignments (receiver_user_id);
CREATE INDEX IF NOT EXISTS idx_consignment_events_c ON public.merchant_consignment_events (consignment_id);

ALTER TABLE public.merchant_consignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.merchant_consignment_events ENABLE ROW LEVEL SECURITY;

-- Reads are scoped to the two participants. All writes go through the RPCs below.
CREATE POLICY "Participants can view consignments"
  ON public.merchant_consignments FOR SELECT TO authenticated
  USING (sender_user_id = auth.uid() OR receiver_user_id = auth.uid());

CREATE POLICY "Participants can view consignment events"
  ON public.merchant_consignment_events FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.merchant_consignments c
    WHERE c.id = consignment_id AND (c.sender_user_id = auth.uid() OR c.receiver_user_id = auth.uid())
  ));

CREATE TRIGGER trg_merchant_consignments_updated_at
  BEFORE UPDATE ON public.merchant_consignments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER PUBLICATION supabase_realtime ADD TABLE public.merchant_consignments;
ALTER PUBLICATION supabase_realtime ADD TABLE public.merchant_consignment_events;

-- USDT still with the receiver: sent minus confirmed sales and returns.
-- Pending reports count too, so two reports cannot both claim the same USDT.
CREATE OR REPLACE FUNCTION public.consignment_open_qty(p_consignment_id UUID)
RETURNS NUMERIC LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.qty_usdt - COALESCE((
    SELECT SUM(e.qty_usdt) FROM public.merchant_consignment_events e
    WHERE e.consignment_id = c.id AND e.kind IN ('sale','return') AND e.status IN ('pending','confirmed')
  ), 0)
  FROM public.merchant_consignments c WHERE c.id = p_consignment_id
$$;

CREATE OR REPLACE FUNCTION public.create_merchant_consignment(
  p_relationship_id UUID, p_qty NUMERIC, p_base_price NUMERIC,
  p_sender_share_pct NUMERIC DEFAULT 50, p_tracker_ref TEXT DEFAULT NULL, p_note TEXT DEFAULT NULL
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
  _other := CASE WHEN _rel.merchant_a_id = _me THEN _rel.merchant_b_id ELSE _rel.merchant_a_id END;
  SELECT user_id INTO _other_user FROM public.merchant_profiles WHERE merchant_id = _other LIMIT 1;
  INSERT INTO public.merchant_consignments
    (relationship_id, sender_merchant_id, receiver_merchant_id, sender_user_id, receiver_user_id,
     qty_usdt, base_price_qar, sender_share_pct, tracker_ref, note)
  VALUES (p_relationship_id, _me, _other, auth.uid(), _other_user,
          p_qty, p_base_price, p_sender_share_pct, p_tracker_ref, p_note)
  RETURNING id INTO _id;
  RETURN _id;
END $$;

CREATE OR REPLACE FUNCTION public.report_consignment_event(
  p_consignment_id UUID, p_kind TEXT, p_qty NUMERIC, p_price NUMERIC DEFAULT NULL, p_note TEXT DEFAULT NULL
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _c public.merchant_consignments%ROWTYPE; _id UUID;
BEGIN
  SELECT * INTO _c FROM public.merchant_consignments WHERE id = p_consignment_id FOR UPDATE;
  IF NOT FOUND OR auth.uid() NOT IN (_c.sender_user_id, _c.receiver_user_id) THEN
    RAISE EXCEPTION 'consignment not found';
  END IF;
  IF _c.status <> 'open' AND p_kind <> 'purchase' THEN RAISE EXCEPTION 'consignment is closed'; END IF;
  IF p_kind IN ('sale','return') AND p_qty > public.consignment_open_qty(p_consignment_id) + 0.000001 THEN
    RAISE EXCEPTION 'quantity exceeds what is still with the receiver';
  END IF;
  -- A sale below the agreed cost would be a loss, which never happens here.
  IF p_kind = 'sale' AND p_price < _c.base_price_qar THEN RAISE EXCEPTION 'sale price is below cost'; END IF;
  INSERT INTO public.merchant_consignment_events (consignment_id, kind, qty_usdt, price_qar, reported_by, note)
  VALUES (p_consignment_id, p_kind, p_qty, CASE WHEN p_kind = 'return' THEN NULL ELSE p_price END, auth.uid(), p_note)
  RETURNING id INTO _id;
  RETURN _id;
END $$;

-- The other participant confirms or rejects a report. The reporter cannot confirm their own.
CREATE OR REPLACE FUNCTION public.respond_consignment_event(p_event_id UUID, p_accept BOOLEAN)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _e public.merchant_consignment_events%ROWTYPE; _c public.merchant_consignments%ROWTYPE;
BEGIN
  SELECT * INTO _e FROM public.merchant_consignment_events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'event not found'; END IF;
  SELECT * INTO _c FROM public.merchant_consignments WHERE id = _e.consignment_id FOR UPDATE;
  IF auth.uid() NOT IN (_c.sender_user_id, _c.receiver_user_id) OR auth.uid() = _e.reported_by THEN
    RAISE EXCEPTION 'not allowed to respond';
  END IF;
  IF _e.status <> 'pending' THEN RAISE EXCEPTION 'already answered'; END IF;
  UPDATE public.merchant_consignment_events
    SET status = CASE WHEN p_accept THEN 'confirmed' ELSE 'rejected' END, responded_at = now()
    WHERE id = p_event_id;
  IF public.consignment_open_qty(_c.id) <= 0.000001 AND NOT EXISTS (
    SELECT 1 FROM public.merchant_consignment_events WHERE consignment_id = _c.id AND kind IN ('sale','return') AND status = 'pending'
  ) THEN
    UPDATE public.merchant_consignments SET status = 'closed' WHERE id = _c.id;
  END IF;
END $$;

-- Tell the other side whenever something is reported or answered.
CREATE OR REPLACE FUNCTION public.fn_notify_consignment_event()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _c public.merchant_consignments%ROWTYPE; _to UUID;
BEGIN
  SELECT * INTO _c FROM public.merchant_consignments WHERE id = NEW.consignment_id;
  _to := CASE WHEN NEW.reported_by = _c.sender_user_id THEN _c.receiver_user_id ELSE _c.sender_user_id END;
  IF _to IS NULL THEN RETURN NEW; END IF;
  INSERT INTO public.notifications (user_id, category, title, body, entity_type, entity_id)
  VALUES (_to, 'message', 'USDT consignment: ' || NEW.kind || ' reported',
          NEW.qty_usdt || ' USDT' || COALESCE(' @ ' || NEW.price_qar, ''), 'merchant_consignment', NEW.consignment_id::text);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_notify_consignment_event ON public.merchant_consignment_events;
CREATE TRIGGER trg_notify_consignment_event
  AFTER INSERT ON public.merchant_consignment_events
  FOR EACH ROW EXECUTE FUNCTION public.fn_notify_consignment_event();

GRANT EXECUTE ON FUNCTION public.create_merchant_consignment(UUID, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.report_consignment_event(UUID, TEXT, NUMERIC, NUMERIC, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.respond_consignment_event(UUID, BOOLEAN) TO authenticated;
