-- Lets a customer, from their own portal, log a payment they made against a
-- loan and have it show up for the merchant to review -- previously the
-- merchant had no channel for a customer-reported payment at all, since
-- loans live only inside the merchant's local-first tracker snapshot
-- (customerLoans in tracker_snapshots.state), which the customer's browser
-- can never write to directly.
--
-- This table is a relational staging area, the same pattern already used
-- for exchange_transfers: the customer inserts a claim, the merchant's own
-- device reviews it and -- if accepted -- creates the actual LoanRepayment
-- (and any cash-ledger entry) through the normal tracker-sync path, so the
-- customer-reported amount is never trusted blindly into the tracker.
CREATE TABLE public.loan_payment_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  customer_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- The merchant-side Customer.id this claim is against (from the buyer's
  -- own buyer_statement_links row -- never trusted from client input beyond
  -- what that link already authorizes).
  customer_id text NOT NULL,
  currency text NOT NULL,
  amount numeric NOT NULL CHECK (amount > 0),
  note text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz
);

ALTER TABLE public.loan_payment_claims ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Customers view own payment claims" ON public.loan_payment_claims
  FOR SELECT TO authenticated
  USING (customer_user_id = auth.uid());

CREATE POLICY "Merchants view payment claims against them" ON public.loan_payment_claims
  FOR SELECT TO authenticated
  USING (merchant_user_id = auth.uid());

-- A customer may only claim a payment against a (merchant, customer_id,
-- currency) combination they actually hold a live buyer_statement_links
-- row for -- the same authorization buyer_statement_links already grants
-- them to view that loan's statement in customer-loan-statement.
CREATE POLICY "Customers submit own payment claims" ON public.loan_payment_claims
  FOR INSERT TO authenticated
  WITH CHECK (
    customer_user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.buyer_statement_links l
      WHERE l.customer_user_id = auth.uid()
        AND l.user_id = merchant_user_id
        AND l.customer_id = customer_id
        AND l.currency = currency
        AND l.revoked_at IS NULL
    )
  );

CREATE POLICY "Merchants review payment claims against them" ON public.loan_payment_claims
  FOR UPDATE TO authenticated
  USING (merchant_user_id = auth.uid())
  WITH CHECK (merchant_user_id = auth.uid());

CREATE INDEX loan_payment_claims_merchant_idx ON public.loan_payment_claims (merchant_user_id, status);
CREATE INDEX loan_payment_claims_customer_idx ON public.loan_payment_claims (customer_user_id);

ALTER PUBLICATION supabase_realtime ADD TABLE public.loan_payment_claims;
