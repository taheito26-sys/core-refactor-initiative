-- Consignment corrections: counter a report, change the profit ratio by agreement, cancel cleanly.
--
-- Each report remembers the ratio it was made under, so a later change never
-- re-prices a sale that was already reported. A countered report is rejected
-- and replaced by the responder's own report, which the original reporter then
-- confirms or rejects like any other.

ALTER TABLE public.merchant_consignments
  ADD COLUMN IF NOT EXISTS pending_share_pct NUMERIC CHECK (pending_share_pct >= 0 AND pending_share_pct <= 100),
  ADD COLUMN IF NOT EXISTS pending_share_by UUID REFERENCES auth.users(id);
ALTER TABLE public.merchant_consignment_events
  ADD COLUMN IF NOT EXISTS sender_share_pct NUMERIC,
  ADD COLUMN IF NOT EXISTS replaces_event_id UUID REFERENCES public.merchant_consignment_events(id);

-- Same function as before, now recording the ratio in force when the report is made.
CREATE OR REPLACE FUNCTION public.report_consignment_event_v2(p_consignment_id uuid, p_kind text, p_qty numeric, p_price numeric DEFAULT NULL::numeric, p_note text DEFAULT NULL::text, p_client_request_id text DEFAULT NULL::text, p_funded_from_sale_id uuid DEFAULT NULL::uuid, p_amount_qar numeric DEFAULT NULL::numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _c public.merchant_consignments%ROWTYPE;
  _id UUID; _existing UUID; _sale public.merchant_consignment_events%ROWTYPE;
  _sale_due NUMERIC;
BEGIN
  SELECT * INTO _c FROM public.merchant_consignments WHERE id = p_consignment_id FOR UPDATE;
  IF NOT FOUND OR auth.uid() NOT IN (_c.sender_user_id, _c.receiver_user_id) THEN
    RAISE EXCEPTION 'consignment not found';
  END IF;
  IF p_client_request_id IS NOT NULL THEN
    SELECT id INTO _existing FROM public.merchant_consignment_events
      WHERE consignment_id = p_consignment_id AND client_request_id = p_client_request_id LIMIT 1;
    IF _existing IS NOT NULL THEN RETURN _existing; END IF;
  END IF;
  IF p_kind NOT IN ('sale','return','purchase','settlement') THEN RAISE EXCEPTION 'invalid event kind'; END IF;
  IF p_qty <= 0 THEN RAISE EXCEPTION 'quantity must be positive'; END IF;
  IF _c.status <> 'open' AND p_kind IN ('sale','return') THEN RAISE EXCEPTION 'consignment is closed'; END IF;
  IF p_kind IN ('sale','return') AND p_qty > public.consignment_open_qty(p_consignment_id) + 0.000001 THEN
    RAISE EXCEPTION 'quantity exceeds what is still with the receiver';
  END IF;
  IF p_kind = 'sale' AND (p_price IS NULL OR p_price <= 0) THEN
    RAISE EXCEPTION 'sale price must be positive';
  END IF;
  IF p_kind = 'purchase' AND (p_price IS NULL OR p_price <= 0) THEN
    RAISE EXCEPTION 'purchase price must be positive';
  END IF;
  IF p_kind = 'return' AND (p_price IS NOT NULL OR p_amount_qar IS NOT NULL) THEN
    RAISE EXCEPTION 'return cannot carry a price or amount';
  END IF;
  IF p_kind = 'settlement' AND (p_amount_qar IS NULL OR p_amount_qar <= 0) THEN
    RAISE EXCEPTION 'settlement amount must be positive';
  END IF;
  IF p_kind IN ('purchase','settlement') AND p_funded_from_sale_id IS NOT NULL THEN
    SELECT * INTO _sale FROM public.merchant_consignment_events
      WHERE id = p_funded_from_sale_id AND consignment_id = p_consignment_id
        AND kind = 'sale' AND status = 'confirmed';
    IF NOT FOUND THEN RAISE EXCEPTION 'funded sale is not confirmed'; END IF;
  END IF;
  IF p_kind = 'settlement' AND p_funded_from_sale_id IS NULL THEN
    RAISE EXCEPTION 'settlement must reference a sale';
  END IF;
  IF p_funded_from_sale_id IS NOT NULL THEN
    _sale_due := public.consignment_sale_net_due_qar(p_funded_from_sale_id);
    IF p_kind = 'purchase' AND p_qty * p_price > _sale_due + 0.01 THEN
      RAISE EXCEPTION 'purchase exceeds the referenced sale proceeds';
    END IF;
    IF p_kind = 'settlement' AND p_amount_qar > _sale_due + 0.01 THEN
      RAISE EXCEPTION 'settlement exceeds the referenced sale proceeds';
    END IF;
  END IF;
  INSERT INTO public.merchant_consignment_events
    (consignment_id, kind, qty_usdt, price_qar, amount_qar, funded_from_sale_id,
     client_request_id, reported_by, note, sender_share_pct)
  VALUES (p_consignment_id, p_kind, p_qty,
          CASE WHEN p_kind IN ('sale','purchase') THEN p_price ELSE NULL END,
          CASE WHEN p_kind = 'settlement' THEN p_amount_qar ELSE NULL END,
          CASE WHEN p_kind IN ('purchase','settlement') THEN p_funded_from_sale_id ELSE NULL END,
          p_client_request_id, auth.uid(), p_note, _c.sender_share_pct)
  RETURNING id INTO _id;
  RETURN _id;
END $function$;


-- Counter a pending report: reject it and propose corrected numbers in its place.
CREATE OR REPLACE FUNCTION public.counter_consignment_event(
  p_event_id UUID, p_qty NUMERIC, p_price NUMERIC DEFAULT NULL, p_note TEXT DEFAULT NULL
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _e public.merchant_consignment_events%ROWTYPE; _c public.merchant_consignments%ROWTYPE; _new UUID;
BEGIN
  SELECT * INTO _e FROM public.merchant_consignment_events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'event not found'; END IF;
  SELECT * INTO _c FROM public.merchant_consignments WHERE id = _e.consignment_id FOR UPDATE;
  IF auth.uid() NOT IN (_c.sender_user_id, _c.receiver_user_id) OR auth.uid() = _e.reported_by THEN
    RAISE EXCEPTION 'not allowed to respond';
  END IF;
  IF _e.status <> 'pending' THEN RAISE EXCEPTION 'already answered'; END IF;
  IF _e.kind NOT IN ('sale','return','purchase') THEN RAISE EXCEPTION 'only sales, returns and purchases can be countered'; END IF;
  UPDATE public.merchant_consignment_events SET status = 'rejected', responded_at = now() WHERE id = _e.id;
  _new := public.report_consignment_event_v2(
    _e.consignment_id, _e.kind, p_qty, CASE WHEN _e.kind = 'return' THEN NULL ELSE p_price END,
    p_note, NULL, _e.funded_from_sale_id, NULL);
  UPDATE public.merchant_consignment_events SET replaces_event_id = _e.id WHERE id = _new;
  RETURN _new;
END $$;

-- Propose a new profit ratio; the other merchant accepts or rejects it.
CREATE OR REPLACE FUNCTION public.propose_consignment_share(p_consignment_id UUID, p_sender_share_pct NUMERIC)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _c public.merchant_consignments%ROWTYPE;
BEGIN
  SELECT * INTO _c FROM public.merchant_consignments WHERE id = p_consignment_id FOR UPDATE;
  IF NOT FOUND OR auth.uid() NOT IN (_c.sender_user_id, _c.receiver_user_id) THEN RAISE EXCEPTION 'consignment not found'; END IF;
  IF _c.status <> 'open' THEN RAISE EXCEPTION 'consignment is not open'; END IF;
  IF p_sender_share_pct < 0 OR p_sender_share_pct > 100 THEN RAISE EXCEPTION 'ratio must be between 0 and 100'; END IF;
  IF p_sender_share_pct = _c.sender_share_pct THEN RAISE EXCEPTION 'ratio is already agreed'; END IF;
  UPDATE public.merchant_consignments SET pending_share_pct = p_sender_share_pct, pending_share_by = auth.uid() WHERE id = _c.id;
END $$;

CREATE OR REPLACE FUNCTION public.respond_consignment_share(p_consignment_id UUID, p_accept BOOLEAN)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _c public.merchant_consignments%ROWTYPE;
BEGIN
  SELECT * INTO _c FROM public.merchant_consignments WHERE id = p_consignment_id FOR UPDATE;
  IF NOT FOUND OR auth.uid() NOT IN (_c.sender_user_id, _c.receiver_user_id) THEN RAISE EXCEPTION 'consignment not found'; END IF;
  IF _c.pending_share_pct IS NULL THEN RAISE EXCEPTION 'no ratio change is waiting'; END IF;
  IF auth.uid() = _c.pending_share_by THEN RAISE EXCEPTION 'not allowed to respond'; END IF;
  UPDATE public.merchant_consignments
    SET sender_share_pct = CASE WHEN p_accept THEN _c.pending_share_pct ELSE sender_share_pct END,
        pending_share_pct = NULL, pending_share_by = NULL
    WHERE id = _c.id;
END $$;

-- The proposer takes their own ratio proposal back.
CREATE OR REPLACE FUNCTION public.withdraw_consignment_share(p_consignment_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.merchant_consignments SET pending_share_pct = NULL, pending_share_by = NULL
    WHERE id = p_consignment_id AND pending_share_by = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'nothing to withdraw'; END IF;
END $$;

-- Cancel: only the sender, only before anything is confirmed. Reports still waiting are rejected with it.
CREATE OR REPLACE FUNCTION public.cancel_merchant_consignment(p_consignment_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _c public.merchant_consignments%ROWTYPE;
BEGIN
  SELECT * INTO _c FROM public.merchant_consignments WHERE id = p_consignment_id FOR UPDATE;
  IF NOT FOUND OR auth.uid() <> _c.sender_user_id THEN RAISE EXCEPTION 'not allowed'; END IF;
  IF _c.status <> 'open' THEN RAISE EXCEPTION 'consignment is not open'; END IF;
  IF EXISTS (SELECT 1 FROM public.merchant_consignment_events WHERE consignment_id = _c.id AND status = 'confirmed') THEN
    RAISE EXCEPTION 'consignment has confirmed events';
  END IF;
  UPDATE public.merchant_consignment_events SET status = 'rejected', responded_at = now() WHERE consignment_id = _c.id AND status = 'pending';
  UPDATE public.merchant_consignments SET status = 'cancelled', pending_share_pct = NULL, pending_share_by = NULL WHERE id = _c.id;
END $$;

-- Tell the other merchant about a cancellation or a ratio change.
CREATE OR REPLACE FUNCTION public.fn_notify_consignment_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _to UUID; _title TEXT; _body TEXT;
BEGIN
  IF NEW.status = 'cancelled' AND OLD.status <> 'cancelled' THEN
    _to := NEW.receiver_user_id; _title := 'USDT consignment cancelled'; _body := NEW.qty_usdt || ' USDT';
  ELSIF NEW.pending_share_pct IS NOT NULL AND NEW.pending_share_pct IS DISTINCT FROM OLD.pending_share_pct THEN
    _to := CASE WHEN NEW.pending_share_by = NEW.sender_user_id THEN NEW.receiver_user_id ELSE NEW.sender_user_id END;
    _title := 'USDT consignment: new profit ratio proposed'; _body := 'Sender share ' || NEW.pending_share_pct || '%';
  ELSIF NEW.sender_share_pct IS DISTINCT FROM OLD.sender_share_pct THEN
    _to := CASE WHEN OLD.pending_share_by = NEW.sender_user_id THEN NEW.sender_user_id ELSE NEW.receiver_user_id END;
    _title := 'USDT consignment: profit ratio agreed'; _body := 'Sender share ' || NEW.sender_share_pct || '%';
  ELSE
    RETURN NEW;
  END IF;
  IF _to IS NULL THEN RETURN NEW; END IF;
  INSERT INTO public.notifications (user_id, category, title, body, entity_type, entity_id)
  VALUES (_to, 'message', _title, _body, 'merchant_consignment', NEW.id::text);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_notify_consignment_change ON public.merchant_consignments;
CREATE TRIGGER trg_notify_consignment_change
  AFTER UPDATE ON public.merchant_consignments
  FOR EACH ROW EXECUTE FUNCTION public.fn_notify_consignment_change();

REVOKE ALL ON FUNCTION public.counter_consignment_event(UUID, NUMERIC, NUMERIC, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.propose_consignment_share(UUID, NUMERIC) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.respond_consignment_share(UUID, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.withdraw_consignment_share(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.counter_consignment_event(UUID, NUMERIC, NUMERIC, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.propose_consignment_share(UUID, NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION public.respond_consignment_share(UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.withdraw_consignment_share(UUID) TO authenticated;

-- Whichever entry point recorded a report, it keeps the ratio in force at that moment.
CREATE OR REPLACE FUNCTION public.fn_snapshot_consignment_share()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.sender_share_pct IS NULL THEN
    SELECT sender_share_pct INTO NEW.sender_share_pct FROM public.merchant_consignments WHERE id = NEW.consignment_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_snapshot_consignment_share ON public.merchant_consignment_events;
CREATE TRIGGER trg_snapshot_consignment_share
  BEFORE INSERT ON public.merchant_consignment_events
  FOR EACH ROW EXECUTE FUNCTION public.fn_snapshot_consignment_share();
