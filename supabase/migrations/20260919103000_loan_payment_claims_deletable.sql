-- Lets a customer withdraw their own payment claim while it's still
-- pending -- previously the only way out of a wrongly-submitted claim was
-- to wait for the merchant to reject it. Once reviewed (accepted or
-- rejected) it stays, same reasoning as the edit policy: an accepted claim
-- already produced a real repayment on the merchant's side, and a rejected
-- one is the merchant's own record of what happened.
CREATE POLICY "Customers delete own pending payment claims" ON public.loan_payment_claims
  FOR DELETE TO authenticated
  USING (customer_user_id = auth.uid() AND status = 'pending');
