-- Consignment: buy outright, and shortfall (USDT that never came back).
--
-- A buy-outright is a sale where the whole profit belongs to the sender
-- (the merchant keeps the USDT at the agreed price), so it reuses the sale
-- event with the sender's share fixed at 100% and is flagged for display.
-- A shortfall is USDT both merchants agree is unaccounted for; once it is
-- confirmed it counts against what is still out, so the consignment can close.

ALTER TABLE public.merchant_consignment_events ADD COLUMN IF NOT EXISTS is_buyout BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.merchant_consignment_events DROP CONSTRAINT IF EXISTS mce_kind_check;
ALTER TABLE public.merchant_consignment_events ADD CONSTRAINT mce_kind_check
  CHECK (kind IN ('sale','return','purchase','settlement','shortfall'));

ALTER TABLE public.merchant_consignment_events DROP CONSTRAINT IF EXISTS mce_value_check;
ALTER TABLE public.merchant_consignment_events ADD CONSTRAINT mce_value_check CHECK (
  (kind IN ('return','shortfall') AND price_qar IS NULL AND amount_qar IS NULL)
  OR (kind = 'sale' AND price_qar > 0 AND amount_qar IS NULL)
  OR (kind = 'purchase' AND price_qar > 0 AND amount_qar IS NULL)
  OR (kind = 'settlement' AND price_qar IS NULL AND amount_qar > 0)
);

CREATE OR REPLACE FUNCTION public.consignment_open_qty(p_consignment_id UUID)
RETURNS NUMERIC LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.qty_usdt - COALESCE((
    SELECT SUM(e.qty_usdt) FROM public.merchant_consignment_events e
    WHERE e.consignment_id = c.id AND e.kind IN ('sale','return','shortfall') AND e.status IN ('pending','confirmed')), 0)
  FROM public.merchant_consignments c WHERE c.id = p_consignment_id
$$;

-- Same function as before; a confirmed shortfall can now close the consignment too.
CREATE OR REPLACE FUNCTION public.respond_consignment_event(p_event_id uuid, p_accept boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _e public.merchant_consignment_events%ROWTYPE; _c public.merchant_consignments%ROWTYPE;
BEGIN
  SELECT * INTO _e FROM public.merchant_consignment_events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'event not found'; END IF;
  SELECT * INTO _c FROM public.merchant_consignments WHERE id = _e.consignment_id FOR UPDATE;
  IF auth.uid() NOT IN (_c.sender_user_id, _c.receiver_user_id) OR auth.uid() = _e.reported_by THEN RAISE EXCEPTION 'not allowed to respond'; END IF;
  IF _e.status <> 'pending' THEN RAISE EXCEPTION 'already answered'; END IF;
  UPDATE public.merchant_consignment_events SET status = CASE WHEN p_accept THEN 'confirmed' ELSE 'rejected' END, responded_at = now() WHERE id = p_event_id;
  IF p_accept AND _e.kind IN ('sale','return','shortfall') AND public.consignment_open_qty(_c.id) <= 0.000001 AND NOT EXISTS (SELECT 1 FROM public.merchant_consignment_events WHERE consignment_id = _c.id AND kind IN ('sale','return','shortfall') AND status = 'pending') THEN UPDATE public.merchant_consignments SET status = 'closed' WHERE id = _c.id; END IF;
END $function$;


-- The merchant keeps (part of) the USDT and pays the agreed price: all of the profit is the sender's.
CREATE OR REPLACE FUNCTION public.report_consignment_buyout(
  p_consignment_id UUID, p_qty NUMERIC, p_price NUMERIC, p_client_request_id TEXT DEFAULT NULL
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _c public.merchant_consignments%ROWTYPE; _id UUID; _existing UUID;
BEGIN
  SELECT * INTO _c FROM public.merchant_consignments WHERE id = p_consignment_id FOR UPDATE;
  IF NOT FOUND OR auth.uid() NOT IN (_c.sender_user_id, _c.receiver_user_id) THEN RAISE EXCEPTION 'consignment not found'; END IF;
  IF p_client_request_id IS NOT NULL THEN
    SELECT id INTO _existing FROM public.merchant_consignment_events WHERE consignment_id = _c.id AND client_request_id = p_client_request_id LIMIT 1;
    IF _existing IS NOT NULL THEN RETURN _existing; END IF;
  END IF;
  IF _c.status <> 'open' THEN RAISE EXCEPTION 'consignment is closed'; END IF;
  IF p_qty <= 0 OR p_price IS NULL OR p_price <= 0 THEN RAISE EXCEPTION 'quantity and price must be positive'; END IF;
  IF p_qty > public.consignment_open_qty(_c.id) + 0.000001 THEN RAISE EXCEPTION 'quantity exceeds what is still with the receiver'; END IF;
  INSERT INTO public.merchant_consignment_events
    (consignment_id, kind, qty_usdt, price_qar, reported_by, client_request_id, sender_share_pct, is_buyout)
  VALUES (_c.id, 'sale', p_qty, p_price, auth.uid(), p_client_request_id, 100, true)
  RETURNING id INTO _id;
  RETURN _id;
END $$;

-- USDT that did not come back and was not sold: both merchants agree it is unaccounted for.
CREATE OR REPLACE FUNCTION public.report_consignment_shortfall(
  p_consignment_id UUID, p_qty NUMERIC, p_note TEXT DEFAULT NULL, p_client_request_id TEXT DEFAULT NULL
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _c public.merchant_consignments%ROWTYPE; _id UUID; _existing UUID;
BEGIN
  SELECT * INTO _c FROM public.merchant_consignments WHERE id = p_consignment_id FOR UPDATE;
  IF NOT FOUND OR auth.uid() NOT IN (_c.sender_user_id, _c.receiver_user_id) THEN RAISE EXCEPTION 'consignment not found'; END IF;
  IF p_client_request_id IS NOT NULL THEN
    SELECT id INTO _existing FROM public.merchant_consignment_events WHERE consignment_id = _c.id AND client_request_id = p_client_request_id LIMIT 1;
    IF _existing IS NOT NULL THEN RETURN _existing; END IF;
  END IF;
  IF _c.status <> 'open' THEN RAISE EXCEPTION 'consignment is closed'; END IF;
  IF p_qty <= 0 THEN RAISE EXCEPTION 'quantity must be positive'; END IF;
  IF p_qty > public.consignment_open_qty(_c.id) + 0.000001 THEN RAISE EXCEPTION 'quantity exceeds what is still with the receiver'; END IF;
  INSERT INTO public.merchant_consignment_events (consignment_id, kind, qty_usdt, reported_by, client_request_id, note)
  VALUES (_c.id, 'shortfall', p_qty, auth.uid(), p_client_request_id, p_note)
  RETURNING id INTO _id;
  RETURN _id;
END $$;

REVOKE ALL ON FUNCTION public.report_consignment_buyout(UUID, NUMERIC, NUMERIC, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.report_consignment_shortfall(UUID, NUMERIC, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.report_consignment_buyout(UUID, NUMERIC, NUMERIC, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.report_consignment_shortfall(UUID, NUMERIC, TEXT, TEXT) TO authenticated;
