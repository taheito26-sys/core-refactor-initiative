-- The merchant's Activity Center previously couldn't tell a loan-payment-
-- claim notification apart from any other 'settlement' notification, so it
-- routed Approve into the settlement RPC and errored ("Settlement <claim
-- id> not found or already processed"). This gives claim notifications
-- their own entity_type (so the client can resolve the right inline
-- action) and a precise target_tab/target_focus (so navigating to
-- /trading/cash lands the merchant on the Loans tab with that exact claim
-- in view, instead of the default Accounts tab).
--
-- Two distinct entity_types, not one:
--   loan_payment_claim         -- a fresh claim awaiting accept/reject
--   loan_payment_claim_change  -- an accepted claim's correction/removal
--                                  request awaiting apply/decline
-- A fresh claim's Reject is a plain status flip (safe from anywhere); its
-- Accept has to allocate the amount across the buyer's open loans and
-- write a real repayment into the merchant's live tracker, which only the
-- mounted Cash Management page can safely do -- so Accept is a navigation,
-- not an inline mutation. Same reasoning for a change request's
-- Apply (Decline, like Reject, is a plain status flip).

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

    INSERT INTO public.notifications (user_id, category, title, body, entity_type, entity_id, target_path, target_tab, target_focus, target_entity_type, target_entity_id)
    VALUES (
      NEW.merchant_user_id, 'settlement',
      COALESCE(_customer_name, 'A customer') || ' reported a payment',
      NEW.amount || ' ' || NEW.currency || COALESCE(' · ' || NEW.note, ''),
      'loan_payment_claim', NEW.id::text,
      '/trading/cash', 'loans', 'focusLoanPaymentClaimId',
      'loan_payment_claim', NEW.id::text
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

    INSERT INTO public.notifications (user_id, category, title, body, entity_type, entity_id, target_path, target_tab, target_focus, target_entity_type, target_entity_id)
    VALUES (
      NEW.merchant_user_id, 'settlement',
      COALESCE(_customer_name, 'A customer')
        || CASE WHEN NEW.change_request = 'delete'
                THEN ' asked to remove a payment'
                ELSE ' asked to correct a payment' END,
      CASE WHEN NEW.change_request = 'delete'
           THEN NEW.amount || ' ' || NEW.currency
           ELSE NEW.amount || ' → ' || COALESCE(NEW.change_amount, NEW.amount) || ' ' || NEW.currency END,
      'loan_payment_claim_change', NEW.id::text,
      '/trading/cash', 'loans', 'focusLoanPaymentClaimId',
      'loan_payment_claim', NEW.id::text
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
