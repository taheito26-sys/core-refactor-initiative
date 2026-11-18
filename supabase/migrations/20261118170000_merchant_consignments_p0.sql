-- P0 consignment patch.
--
-- This migration is intentionally additive and idempotent: the original
-- 20261118160000 migration was never applied to the live database, and this
-- file must also upgrade an environment where it was applied.
--
-- Fixes:
--   1. Create/upgrade the consignment tables and RPCs.
--   2. Add client-request idempotency keys and a unique tracker ref.
--   3. Link a replacement purchase to the confirmed sale whose proceeds funded it.
--   4. Add a settlement event so owner cash-in and receiver cash-out are booked
--      on both sides instead of only changing a display number.

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
  client_request_id TEXT,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.merchant_consignment_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consignment_id UUID NOT NULL REFERENCES public.merchant_consignments(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  qty_usdt NUMERIC NOT NULL CHECK (qty_usdt > 0),
  price_qar NUMERIC,
  amount_qar NUMERIC,
  funded_from_sale_id UUID,
  client_request_id TEXT,
  reported_by UUID NOT NULL REFERENCES auth.users(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','rejected')),
  note TEXT,
  responded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.merchant_consignments
  ADD COLUMN IF NOT EXISTS client_request_id TEXT;
ALTER TABLE public.merchant_consignment_events
  ADD COLUMN IF NOT EXISTS client_request_id TEXT,
  ADD COLUMN IF NOT EXISTS funded_from_sale_id UUID,
  ADD COLUMN IF NOT EXISTS amount_qar NUMERIC;

-- The original migration used unnamed inline checks. Replace them with named
-- checks so this migration can upgrade either an empty or an existing schema.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.merchant_consignment_events'::regclass
      AND contype = 'c'
  LOOP
    EXECUTE format('ALTER TABLE public.merchant_consignment_events DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE public.merchant_consignment_events
  ADD CONSTRAINT mce_kind_check CHECK (kind IN ('sale','return','purchase','settlement')),
  ADD CONSTRAINT mce_qty_check CHECK (qty_usdt > 0),
  ADD CONSTRAINT mce_value_check CHECK (
    (kind = 'return' AND price_qar IS NULL AND amount_qar IS NULL) OR
    (kind = 'sale' AND price_qar > 0 AND amount_qar IS NULL) OR
    (kind = 'purchase' AND price_qar > 0 AND amount_qar IS NULL) OR
    (kind = 'settlement' AND price_qar IS NULL AND amount_qar > 0)
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'mce_funded_sale_fk'
  ) THEN
    ALTER TABLE public.merchant_consignment_events
      ADD CONSTRAINT mce_funded_sale_fk
      FOREIGN KEY (funded_from_sale_id)
      REFERENCES public.merchant_consignment_events(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_consignments_tracker_ref
  ON public.merchant_consignments (tracker_ref) WHERE tracker_ref IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_consignments_client_request
  ON public.merchant_consignments (sender_user_id, client_request_id) WHERE client_request_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_events_client_request
  ON public.merchant_consignment_events (consignment_id, client_request_id) WHERE client_request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_consignments_sender ON public.merchant_consignments (sender_user_id);
CREATE INDEX IF NOT EXISTS idx_consignments_receiver ON public.merchant_consignments (receiver_user_id);
CREATE INDEX IF NOT EXISTS idx_consignment_events_c ON public.merchant_consignment_events (consignment_id);
CREATE INDEX IF NOT EXISTS idx_consignment_events_funded ON public.merchant_consignment_events (funded_from_sale_id);

ALTER TABLE public.merchant_consignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.merchant_consignment_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Participants can view consignments" ON public.merchant_consignments;
CREATE POLICY "Participants can view consignments"
  ON public.merchant_consignments FOR SELECT TO authenticated
  USING (sender_user_id = auth.uid() OR receiver_user_id = auth.uid());

DROP POLICY IF EXISTS "Participants can view consignment events" ON public.merchant_consignment_events;
CREATE POLICY "Participants can view consignment events"
  ON public.merchant_consignment_events FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.merchant_consignments c
    WHERE c.id = consignment_id AND (c.sender_user_id = auth.uid() OR c.receiver_user_id = auth.uid())
  ));

GRANT SELECT ON public.merchant_consignments TO authenticated;
GRANT SELECT ON public.merchant_consignment_events TO authenticated;

DROP TRIGGER IF EXISTS trg_merchant_consignments_updated_at ON public.merchant_consignments;
CREATE TRIGGER trg_merchant_consignments_updated_at
  BEFORE UPDATE ON public.merchant_consignments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'merchant_consignments'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.merchant_consignments;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'merchant_consignment_events'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.merchant_consignment_events;
  END IF;
END $$;

-- USDT still with the receiver: sent minus confirmed/pending sales and returns.
CREATE OR REPLACE FUNCTION public.consignment_open_qty(p_consignment_id UUID)
RETURNS NUMERIC LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.qty_usdt - COALESCE((
    SELECT SUM(e.qty_usdt) FROM public.merchant_consignment_events e
    WHERE e.consignment_id = c.id AND e.kind IN ('sale','return') AND e.status IN ('pending','confirmed')
  ), 0)
  FROM public.merchant_consignments c WHERE c.id = p_consignment_id
$$;

-- Cash still due to the owner on the whole consignment. A sale contributes
-- proceeds minus the receiver's profit share; a funded replacement purchase
-- and a settlement reduce it.
CREATE OR REPLACE FUNCTION public.consignment_net_due_qar(p_consignment_id UUID)
RETURNS NUMERIC LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(ROUND(SUM(
    CASE
      WHEN e.kind = 'sale' THEN
        e.qty_usdt * e.price_qar
        - e.qty_usdt * (e.price_qar - c.base_price_qar) * (1 - c.sender_share_pct / 100.0)
      WHEN e.kind = 'purchase' AND e.funded_from_sale_id IS NOT NULL THEN
        -e.qty_usdt * e.price_qar
      WHEN e.kind = 'settlement' THEN
        -e.amount_qar
      ELSE 0
    END
  ), 2), 0)
  FROM public.merchant_consignment_events e
  JOIN public.merchant_consignments c ON c.id = e.consignment_id
  WHERE e.consignment_id = p_consignment_id AND e.status = 'confirmed'
$$;

CREATE OR REPLACE FUNCTION public.create_merchant_consignment_v2(
  p_relationship_id UUID, p_qty NUMERIC, p_base_price NUMERIC,
  p_sender_share_pct NUMERIC DEFAULT 50, p_tracker_ref TEXT DEFAULT NULL,
  p_note TEXT DEFAULT NULL, p_client_request_id TEXT DEFAULT NULL
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _me TEXT := public.current_merchant_id();
  _rel public.merchant_relationships%ROWTYPE;
  _other TEXT; _other_user UUID; _id UUID; _existing UUID;
BEGIN
  IF p_qty <= 0 OR p_base_price <= 0 THEN RAISE EXCEPTION 'invalid quantity or price'; END IF;
  IF p_sender_share_pct < 0 OR p_sender_share_pct > 100 THEN RAISE EXCEPTION 'invalid share'; END IF;
  SELECT * INTO _rel FROM public.merchant_relationships WHERE id = p_relationship_id AND status = 'active';
  IF NOT FOUND OR _me IS NULL OR _me NOT IN (_rel.merchant_a_id, _rel.merchant_b_id) THEN
    RAISE EXCEPTION 'not a member of an active relationship';
  END IF;
  IF p_client_request_id IS NOT NULL THEN
    SELECT id INTO _existing FROM public.merchant_consignments
      WHERE sender_user_id = auth.uid() AND client_request_id = p_client_request_id LIMIT 1;
    IF _existing IS NOT NULL THEN RETURN _existing; END IF;
  END IF;
  _other := CASE WHEN _rel.merchant_a_id = _me THEN _rel.merchant_b_id ELSE _rel.merchant_a_id END;
  SELECT user_id INTO _other_user FROM public.merchant_profiles WHERE merchant_id = _other ORDER BY user_id LIMIT 1;
  INSERT INTO public.merchant_consignments
    (relationship_id, sender_merchant_id, receiver_merchant_id, sender_user_id, receiver_user_id,
     qty_usdt, base_price_qar, sender_share_pct, tracker_ref, note, client_request_id)
  VALUES (p_relationship_id, _me, _other, auth.uid(), _other_user,
          p_qty, p_base_price, p_sender_share_pct, p_tracker_ref, p_note, p_client_request_id)
  RETURNING id INTO _id;
  RETURN _id;
END $$;

-- Original six-argument RPC, kept so the currently deployed UI keeps working
-- during the migration/deploy window. New clients use the _v2 function.
CREATE OR REPLACE FUNCTION public.create_merchant_consignment(
  p_relationship_id UUID, p_qty NUMERIC, p_base_price NUMERIC,
  p_sender_share_pct NUMERIC DEFAULT 50, p_tracker_ref TEXT DEFAULT NULL,
  p_note TEXT DEFAULT NULL
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
  SELECT user_id INTO _other_user FROM public.merchant_profiles WHERE merchant_id = _other ORDER BY user_id LIMIT 1;
  INSERT INTO public.merchant_consignments
    (relationship_id, sender_merchant_id, receiver_merchant_id, sender_user_id, receiver_user_id,
     qty_usdt, base_price_qar, sender_share_pct, tracker_ref, note)
  VALUES (p_relationship_id, _me, _other, auth.uid(), _other_user,
          p_qty, p_base_price, p_sender_share_pct, p_tracker_ref, p_note)
  RETURNING id INTO _id;
  RETURN _id;
END $$;

CREATE OR REPLACE FUNCTION public.report_consignment_event_v2(
  p_consignment_id UUID, p_kind TEXT, p_qty NUMERIC,
  p_price NUMERIC DEFAULT NULL, p_note TEXT DEFAULT NULL,
  p_client_request_id TEXT DEFAULT NULL, p_funded_from_sale_id UUID DEFAULT NULL,
  p_amount_qar NUMERIC DEFAULT NULL
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _c public.merchant_consignments%ROWTYPE;
  _id UUID; _existing UUID; _sale public.merchant_consignment_events%ROWTYPE;
  _due NUMERIC;
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
  IF p_kind = 'sale' AND (p_price IS NULL OR p_price < _c.base_price_qar) THEN
    RAISE EXCEPTION 'sale price is below cost';
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
  _due := public.consignment_net_due_qar(p_consignment_id);
  IF p_kind = 'purchase' AND p_funded_from_sale_id IS NOT NULL
     AND p_qty * p_price > _due + 0.01 THEN
    RAISE EXCEPTION 'purchase exceeds the outstanding sale proceeds';
  END IF;
  IF p_kind = 'settlement' AND p_amount_qar > _due + 0.01 THEN
    RAISE EXCEPTION 'settlement exceeds the outstanding amount';
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

-- Original five-argument RPC, kept for the currently deployed UI. New clients
-- use report_consignment_event_v2 so settlement/funding fields are available.
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
  IF p_kind = 'sale' AND p_price < _c.base_price_qar THEN RAISE EXCEPTION 'sale price is below cost'; END IF;
  INSERT INTO public.merchant_consignment_events (consignment_id, kind, qty_usdt, price_qar, reported_by, note)
  VALUES (p_consignment_id, p_kind, p_qty, CASE WHEN p_kind = 'return' THEN NULL ELSE p_price END, auth.uid(), p_note)
  RETURNING id INTO _id;
  RETURN _id;
END $$;

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
  IF p_accept AND _e.kind IN ('sale','return')
     AND public.consignment_open_qty(_c.id) <= 0.000001
     AND NOT EXISTS (
       SELECT 1 FROM public.merchant_consignment_events
       WHERE consignment_id = _c.id AND kind IN ('sale','return') AND status = 'pending'
     ) THEN
    UPDATE public.merchant_consignments SET status = 'closed' WHERE id = _c.id;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.cancel_merchant_consignment(p_consignment_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _c public.merchant_consignments%ROWTYPE;
BEGIN
  SELECT * INTO _c FROM public.merchant_consignments WHERE id = p_consignment_id FOR UPDATE;
  IF NOT FOUND OR auth.uid() <> _c.sender_user_id THEN RAISE EXCEPTION 'not allowed'; END IF;
  IF _c.status <> 'open' THEN RAISE EXCEPTION 'consignment is not open'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.merchant_consignment_events
    WHERE consignment_id = _c.id AND status = 'confirmed'
  ) THEN RAISE EXCEPTION 'consignment has confirmed events'; END IF;
  UPDATE public.merchant_consignments SET status = 'cancelled' WHERE id = _c.id;
END $$;

CREATE OR REPLACE FUNCTION public.fn_notify_consignment_event()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _c public.merchant_consignments%ROWTYPE; _to UUID; _body TEXT;
BEGIN
  SELECT * INTO _c FROM public.merchant_consignments WHERE id = NEW.consignment_id;
  _to := CASE WHEN NEW.reported_by = _c.sender_user_id THEN _c.receiver_user_id ELSE _c.sender_user_id END;
  IF _to IS NULL THEN RETURN NEW; END IF;
  _body := CASE
    WHEN NEW.kind = 'settlement' THEN NEW.amount_qar || ' QAR settlement'
    ELSE NEW.qty_usdt || ' USDT' || COALESCE(' @ ' || NEW.price_qar, '')
  END;
  INSERT INTO public.notifications (user_id, category, title, body, entity_type, entity_id)
  VALUES (_to, 'message', 'USDT consignment: ' || NEW.kind || ' reported',
          _body, 'merchant_consignment', NEW.consignment_id::text);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_notify_consignment_event ON public.merchant_consignment_events;
CREATE TRIGGER trg_notify_consignment_event
  AFTER INSERT ON public.merchant_consignment_events
  FOR EACH ROW EXECUTE FUNCTION public.fn_notify_consignment_event();

REVOKE ALL ON FUNCTION public.consignment_open_qty(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.consignment_net_due_qar(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_merchant_consignment_v2(UUID, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_merchant_consignment(UUID, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.report_consignment_event_v2(UUID, TEXT, NUMERIC, NUMERIC, TEXT, TEXT, UUID, NUMERIC) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.report_consignment_event(UUID, TEXT, NUMERIC, NUMERIC, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.respond_consignment_event(UUID, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_merchant_consignment(UUID) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.create_merchant_consignment_v2(UUID, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_merchant_consignment(UUID, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.report_consignment_event_v2(UUID, TEXT, NUMERIC, NUMERIC, TEXT, TEXT, UUID, NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION public.report_consignment_event(UUID, TEXT, NUMERIC, NUMERIC, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.respond_consignment_event(UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_merchant_consignment(UUID) TO authenticated;
