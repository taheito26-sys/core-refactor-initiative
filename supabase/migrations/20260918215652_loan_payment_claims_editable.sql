-- Lets a customer correct their own payment claim (amount, note, and the
-- date the payment was actually made) while it's still pending -- before
-- this, the only date recorded was created_at (when they tapped submit),
-- and there was no way to fix a mistyped amount short of the merchant
-- rejecting it and asking them to resubmit.
ALTER TABLE public.loan_payment_claims
  ADD COLUMN IF NOT EXISTS paid_at timestamptz NOT NULL DEFAULT now();

-- Once a merchant has reviewed a claim (accepted or rejected), editing it
-- must stop -- an edit after accept could no longer be reconciled with the
-- repayment it already produced. The WITH CHECK repeats status = 'pending'
-- so an edit also can't itself change the status out from under a review.
CREATE POLICY "Customers edit own pending payment claims" ON public.loan_payment_claims
  FOR UPDATE TO authenticated
  USING (customer_user_id = auth.uid() AND status = 'pending')
  WITH CHECK (customer_user_id = auth.uid() AND status = 'pending');
