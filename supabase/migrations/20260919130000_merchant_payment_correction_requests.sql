-- Extends the loan_payment_claims correction flow (20260919120000) to cover
-- a payment the *merchant* entered directly -- until now a customer could
-- only ask to correct/remove a payment they themselves had reported,
-- because that flow always hung off an existing claim row. A merchant-
-- entered repayment has no such row, so the "Payments Received" list on the
-- customer portal silently had no edit/delete for roughly half its rows.
--
-- Rather than a new table, this reuses loan_payment_claims as the same
-- staging area: a `source` column tells the merchant's applyClaimChange
-- whether the payment it's hunting for in the tracker snapshot carries the
-- "Customer-reported" note prefix (customer_claim) or not (merchant_payment).

ALTER TABLE public.loan_payment_claims
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'customer_claim';

ALTER TABLE public.loan_payment_claims
  DROP CONSTRAINT IF EXISTS loan_payment_claims_source_check;
ALTER TABLE public.loan_payment_claims
  ADD CONSTRAINT loan_payment_claims_source_check
  CHECK (source IN ('customer_claim', 'merchant_payment'));

-- One open correction row per distinct merchant-entered payment -- keyed on
-- the same (merchant, customer, currency, amount, day) tuple the customer
-- portal already groups payments by, so re-opening the edit modal on the
-- same row updates it instead of stacking duplicate requests.
CREATE UNIQUE INDEX IF NOT EXISTS loan_payment_claims_merchant_payment_uidx
  ON public.loan_payment_claims (merchant_user_id, customer_user_id, customer_id, currency, amount, paid_at)
  WHERE source = 'merchant_payment';

-- Creates (or updates, if one is already open) a correction request against
-- a payment the merchant put on the books directly -- there is no prior
-- claim row to attach this to, so the row is inserted pre-"accepted" with
-- the request already on it, mirroring the shape request_loan_payment_claim_change
-- produces for a customer's own claim.
CREATE OR REPLACE FUNCTION public.request_merchant_payment_correction(
  p_merchant_user_id uuid,
  p_customer_id text,
  p_currency text,
  p_amount numeric,
  p_paid_at timestamptz,
  p_kind text,
  p_change_amount numeric DEFAULT NULL,
  p_change_note text DEFAULT NULL,
  p_change_paid_at timestamptz DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _id uuid;
BEGIN
  IF p_kind NOT IN ('edit', 'delete') THEN
    RAISE EXCEPTION 'Invalid change kind: %', p_kind;
  END IF;
  IF p_kind = 'edit' AND NOT (COALESCE(p_change_amount, 0) > 0) THEN
    RAISE EXCEPTION 'An edit request needs a positive amount';
  END IF;
  IF NOT (p_amount > 0) THEN
    RAISE EXCEPTION 'Invalid payment amount';
  END IF;

  -- Same authorization the customer's own loan statement and claims already
  -- require: a live buyer_statement_links row for this exact loan.
  IF NOT EXISTS (
    SELECT 1 FROM public.buyer_statement_links l
    WHERE l.customer_user_id = auth.uid()
      AND l.user_id = p_merchant_user_id
      AND l.customer_id = p_customer_id
      AND l.currency = p_currency
      AND l.revoked_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Not authorized for that loan';
  END IF;

  INSERT INTO public.loan_payment_claims (
    merchant_user_id, customer_user_id, customer_id, currency, amount, paid_at,
    status, source, change_request, change_amount, change_note, change_paid_at, change_requested_at
  )
  VALUES (
    p_merchant_user_id, auth.uid(), p_customer_id, p_currency, p_amount, p_paid_at,
    'accepted', 'merchant_payment', p_kind,
    CASE WHEN p_kind = 'edit' THEN p_change_amount END,
    CASE WHEN p_kind = 'edit' THEN p_change_note END,
    CASE WHEN p_kind = 'edit' THEN p_change_paid_at END,
    now()
  )
  ON CONFLICT (merchant_user_id, customer_user_id, customer_id, currency, amount, paid_at)
    WHERE source = 'merchant_payment'
  DO UPDATE SET
    change_request = EXCLUDED.change_request,
    change_amount = EXCLUDED.change_amount,
    change_note = EXCLUDED.change_note,
    change_paid_at = EXCLUDED.change_paid_at,
    change_requested_at = now()
  RETURNING id INTO _id;

  RETURN _id;
END;
$$;

-- Cancels a still-open correction request against a merchant-entered
-- payment. Unlike a customer_claim (a real record of money the merchant
-- already confirmed), this row only ever existed to carry the request, so
-- cancelling it deletes the row outright rather than clearing it in place.
CREATE OR REPLACE FUNCTION public.cancel_merchant_payment_correction(
  p_claim_id uuid
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  DELETE FROM public.loan_payment_claims
   WHERE id = p_claim_id
     AND customer_user_id = auth.uid()
     AND source = 'merchant_payment'
     AND change_request IS NOT NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No open request to cancel';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.request_merchant_payment_correction(uuid, text, text, numeric, timestamptz, text, numeric, text, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_merchant_payment_correction(uuid) TO authenticated;

-- fn_notify_loan_payment_claim's INSERT branch assumed every inserted row
-- was a fresh customer-submitted claim ("<name> reported a payment") and
-- returned before ever reaching the change-request branch below it. A
-- merchant_payment correction row is inserted already carrying the request,
-- so it needs the "asked to correct/remove a payment" notification instead
-- -- falling through to the existing change_request block rather than
-- returning early.
CREATE OR REPLACE FUNCTION public.fn_notify_loan_payment_claim()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _customer_name TEXT;
  _merchant_name TEXT;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.source = 'customer_claim' THEN
    SELECT display_name INTO _customer_name
    FROM public.customer_profiles WHERE user_id = NEW.customer_user_id LIMIT 1;

    INSERT INTO public.notifications (user_id, category, title, body, entity_type, entity_id, target_path, target_entity_type, target_entity_id)
    VALUES (
      NEW.merchant_user_id, 'settlement',
      COALESCE(_customer_name, 'A customer') || ' reported a payment',
      NEW.amount || ' ' || NEW.currency || COALESCE(' · ' || NEW.note, ''),
      'loan_payment_claim', NEW.id::text,
      '/trading/cash', 'loan_payment_claim', NEW.id::text
    );
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status AND NEW.status IN ('accepted', 'rejected') THEN
    SELECT display_name INTO _merchant_name
    FROM public.merchant_profiles WHERE user_id = NEW.merchant_user_id LIMIT 1;

    INSERT INTO public.notifications (user_id, category, title, body, entity_type, entity_id, target_path, target_entity_type, target_entity_id)
    VALUES (
      NEW.customer_user_id, 'settlement',
      CASE WHEN NEW.status = 'accepted'
        THEN COALESCE(_merchant_name, 'The merchant') || ' confirmed your payment'
        ELSE COALESCE(_merchant_name, 'The merchant') || ' could not confirm your payment'
      END,
      NEW.amount || ' ' || NEW.currency,
      'loan_payment_claim', NEW.id::text,
      '/c/wallet', 'loan_payment_claim', NEW.id::text
    );
  END IF;

  -- Customer asked for an already-accepted payment to be changed or removed
  -- -- fires on both a fresh merchant_payment correction row (TG_OP='INSERT',
  -- change_request already set) and a later change on an existing claim.
  IF NEW.change_request IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.change_request IS NULL) THEN
    SELECT display_name INTO _customer_name
    FROM public.customer_profiles WHERE user_id = NEW.customer_user_id LIMIT 1;

    INSERT INTO public.notifications (user_id, category, title, body, entity_type, entity_id, target_path, target_entity_type, target_entity_id)
    VALUES (
      NEW.merchant_user_id, 'settlement',
      COALESCE(_customer_name, 'A customer')
        || CASE WHEN NEW.change_request = 'delete'
                THEN ' asked to remove a payment'
                ELSE ' asked to correct a payment' END,
      CASE WHEN NEW.change_request = 'delete'
           THEN NEW.amount || ' ' || NEW.currency
           ELSE NEW.amount || ' → ' || COALESCE(NEW.change_amount, NEW.amount) || ' ' || NEW.currency END,
      'loan_payment_claim', NEW.id::text,
      '/trading/cash', 'loan_payment_claim', NEW.id::text
    );
  END IF;

  -- Merchant applied or declined that request.
  IF TG_OP = 'UPDATE' AND OLD.change_request IS NOT NULL AND NEW.change_request IS NULL THEN
    SELECT display_name INTO _merchant_name
    FROM public.merchant_profiles WHERE user_id = NEW.merchant_user_id LIMIT 1;

    INSERT INTO public.notifications (user_id, category, title, body, entity_type, entity_id, target_path, target_entity_type, target_entity_id)
    VALUES (
      NEW.customer_user_id, 'settlement',
      COALESCE(_merchant_name, 'The merchant')
        || CASE WHEN NEW.status = 'withdrawn' OR OLD.amount IS DISTINCT FROM NEW.amount
                THEN ' applied your payment change'
                ELSE ' declined your payment change' END,
      NEW.amount || ' ' || NEW.currency,
      'loan_payment_claim', NEW.id::text,
      '/c/wallet', 'loan_payment_claim', NEW.id::text
    );
  END IF;

  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
