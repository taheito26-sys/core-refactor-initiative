-- Loan payment claims (loan_payment_claims) previously had no notification
-- fan-out: a customer reporting a payment left the merchant with nothing in
-- their bell short of opening Cash Management and noticing the pending list,
-- and the merchant accepting/rejecting it left the customer with no signal
-- either. Mirrors the pattern already used for customer_orders
-- (fn_notify_customer_order_workflow).

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

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_loan_payment_claim ON public.loan_payment_claims;
CREATE TRIGGER trg_notify_loan_payment_claim
  AFTER INSERT OR UPDATE ON public.loan_payment_claims
  FOR EACH ROW EXECUTE FUNCTION public.fn_notify_loan_payment_claim();

NOTIFY pgrst, 'reload schema';
