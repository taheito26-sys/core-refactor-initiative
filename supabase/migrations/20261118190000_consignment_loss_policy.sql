-- Consignment loss policy and sale-specific funding limits.
--
-- A below-cost sale is valid and shares its loss by the same ratio as a
-- profit. The receiver's signed share is negative, so the owner receives the
-- proceeds plus the receiver's loss share. The SQL receivable formula already
-- handles this; the RPC no longer rejects a price below the agreed base.
--
-- A replacement purchase or settlement funded from a sale is limited to that
-- sale's remaining proceeds, not the whole consignment's outstanding balance.
-- Without this, a purchase can consume another sale's headroom, pass the
-- server check, and then fail on both clients with exceeds_open.

CREATE OR REPLACE FUNCTION public.consignment_sale_net_due_qar(p_sale_id UUID)
RETURNS NUMERIC LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(ROUND(
    (
      e.qty_usdt * e.price_qar
      - e.qty_usdt * (e.price_qar - c.base_price_qar) * (1 - c.sender_share_pct / 100.0)
    )
    - COALESCE((
      SELECT SUM(
        CASE
          WHEN x.kind = 'purchase' THEN x.qty_usdt * x.price_qar
          WHEN x.kind = 'settlement' THEN x.amount_qar
          ELSE 0
        END
      )
      FROM public.merchant_consignment_events x
      WHERE x.consignment_id = e.consignment_id
        AND x.status = 'confirmed'
        AND x.funded_from_sale_id = e.id
    ), 0)
  , 2), 0)
  FROM public.merchant_consignment_events e
  JOIN public.merchant_consignments c ON c.id = e.consignment_id
  WHERE e.id = p_sale_id AND e.kind = 'sale' AND e.status = 'confirmed'
$$;

CREATE OR REPLACE FUNCTION public.report_consignment_event_v2(
  p_consignment_id UUID, p_kind TEXT, p_qty NUMERIC,
  p_price NUMERIC DEFAULT NULL, p_note TEXT DEFAULT NULL,
  p_client_request_id TEXT DEFAULT NULL, p_funded_from_sale_id UUID DEFAULT NULL,
  p_amount_qar NUMERIC DEFAULT NULL
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
     client_request_id, reported_by, note)
  VALUES (p_consignment_id, p_kind, p_qty,
          CASE WHEN p_kind IN ('sale','purchase') THEN p_price ELSE NULL END,
          CASE WHEN p_kind = 'settlement' THEN p_amount_qar ELSE NULL END,
          CASE WHEN p_kind IN ('purchase','settlement') THEN p_funded_from_sale_id ELSE NULL END,
          p_client_request_id, auth.uid(), p_note)
  RETURNING id INTO _id;
  RETURN _id;
END $$;

CREATE OR REPLACE FUNCTION public.report_consignment_event(
  p_consignment_id UUID, p_kind TEXT, p_qty NUMERIC,
  p_price NUMERIC DEFAULT NULL, p_note TEXT DEFAULT NULL
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
  IF p_kind = 'sale' AND (p_price IS NULL OR p_price <= 0) THEN RAISE EXCEPTION 'sale price must be positive'; END IF;
  INSERT INTO public.merchant_consignment_events (consignment_id, kind, qty_usdt, price_qar, reported_by, note)
  VALUES (p_consignment_id, p_kind, p_qty, CASE WHEN p_kind = 'return' THEN NULL ELSE p_price END, auth.uid(), p_note)
  RETURNING id INTO _id;
  RETURN _id;
END $$;

REVOKE ALL ON FUNCTION public.consignment_sale_net_due_qar(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.report_consignment_event_v2(UUID, TEXT, NUMERIC, NUMERIC, TEXT, TEXT, UUID, NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION public.report_consignment_event(UUID, TEXT, NUMERIC, NUMERIC, TEXT) TO authenticated;
