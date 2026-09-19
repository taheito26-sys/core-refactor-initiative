-- Edit/delete for a payment the customer reported and the merchant already
-- accepted. Accepting a claim creates a real LoanRepayment inside the
-- merchant's tracker snapshot (tracker_snapshots.state), which the
-- customer's browser has no write path to -- so the customer can only ask,
-- and the merchant's own device applies the change through the normal
-- tracker-sync path. Same staging-area shape the claim itself already uses.

ALTER TABLE public.loan_payment_claims
  -- The batchId stamped on every repayment this claim produced, so applying
  -- a later change finds exactly those rows instead of guessing. Null on
  -- claims accepted before this column existed.
  ADD COLUMN IF NOT EXISTS applied_batch_id text,
  ADD COLUMN IF NOT EXISTS change_request text,
  ADD COLUMN IF NOT EXISTS change_amount numeric,
  ADD COLUMN IF NOT EXISTS change_note text,
  ADD COLUMN IF NOT EXISTS change_paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS change_requested_at timestamptz;

ALTER TABLE public.loan_payment_claims
  DROP CONSTRAINT IF EXISTS loan_payment_claims_change_request_check;
ALTER TABLE public.loan_payment_claims
  ADD CONSTRAINT loan_payment_claims_change_request_check
  CHECK (change_request IS NULL OR change_request IN ('edit', 'delete'));

-- 'withdrawn' is where an accepted claim lands once the merchant applies a
-- removal request: the repayment is gone from the tracker, so the claim is
-- no longer a record of money received, but it isn't a rejection either.
ALTER TABLE public.loan_payment_claims
  DROP CONSTRAINT IF EXISTS loan_payment_claims_status_check;
ALTER TABLE public.loan_payment_claims
  ADD CONSTRAINT loan_payment_claims_status_check
  CHECK (status IN ('pending', 'accepted', 'rejected', 'withdrawn'));

-- Both sides go through SECURITY DEFINER RPCs rather than a broader UPDATE
-- policy: RLS can gate the row but not which columns move, and a customer
-- must not be able to rewrite the amount/status of a claim the merchant has
-- already reconciled against -- only to attach a request to it.

-- p_kind NULL cancels an outstanding request.
CREATE OR REPLACE FUNCTION public.request_loan_payment_claim_change(
  p_claim_id uuid,
  p_kind text DEFAULT NULL,
  p_amount numeric DEFAULT NULL,
  p_note text DEFAULT NULL,
  p_paid_at timestamptz DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF p_kind IS NOT NULL AND p_kind NOT IN ('edit', 'delete') THEN
    RAISE EXCEPTION 'Invalid change kind: %', p_kind;
  END IF;
  IF p_kind = 'edit' AND NOT (COALESCE(p_amount, 0) > 0) THEN
    RAISE EXCEPTION 'An edit request needs a positive amount';
  END IF;

  UPDATE public.loan_payment_claims
     SET change_request      = p_kind,
         change_amount       = CASE WHEN p_kind = 'edit' THEN p_amount END,
         change_note         = CASE WHEN p_kind = 'edit' THEN p_note END,
         change_paid_at      = CASE WHEN p_kind = 'edit' THEN p_paid_at END,
         change_requested_at = CASE WHEN p_kind IS NULL THEN NULL ELSE now() END
   WHERE id = p_claim_id
     AND customer_user_id = auth.uid()
     AND status = 'accepted';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No accepted payment of yours to change';
  END IF;
END;
$$;

-- Called by the merchant's device after it has actually applied (or decided
-- to decline) the change in its own tracker state.
CREATE OR REPLACE FUNCTION public.resolve_loan_payment_claim_change(
  p_claim_id uuid,
  p_action text
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF p_action NOT IN ('applied', 'declined') THEN
    RAISE EXCEPTION 'Invalid action: %', p_action;
  END IF;

  UPDATE public.loan_payment_claims
     SET amount = CASE WHEN p_action = 'applied' AND change_request = 'edit'
                       THEN COALESCE(change_amount, amount) ELSE amount END,
         note = CASE WHEN p_action = 'applied' AND change_request = 'edit'
                     THEN change_note ELSE note END,
         paid_at = CASE WHEN p_action = 'applied' AND change_request = 'edit'
                        THEN COALESCE(change_paid_at, paid_at) ELSE paid_at END,
         status = CASE WHEN p_action = 'applied' AND change_request = 'delete'
                       THEN 'withdrawn' ELSE status END,
         change_request = NULL,
         change_amount = NULL,
         change_note = NULL,
         change_paid_at = NULL,
         change_requested_at = NULL,
         reviewed_at = now()
   WHERE id = p_claim_id
     AND merchant_user_id = auth.uid()
     AND change_request IS NOT NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No open change request on that payment';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.request_loan_payment_claim_change(uuid, text, numeric, text, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_loan_payment_claim_change(uuid, text) TO authenticated;

-- ── Notification fan-out for the new events ──
CREATE OR REPLACE FUNCTION public.fn_notify_loan_payment_claim()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _customer_name TEXT;
  _merchant_name TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
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

  -- Customer asked for an already-accepted payment to be changed or removed.
  IF TG_OP = 'UPDATE' AND OLD.change_request IS NULL AND NEW.change_request IS NOT NULL THEN
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
