-- Accepting a customer's payment claim used to be two unrelated writes: the
-- repayments went into the merchant's tracker snapshot, then the claim row was
-- flipped to 'accepted' by a second, separate update. When the second write
-- failed the claim stayed pending and could be accepted again (applying the
-- payment twice); and nothing stopped a claim from being marked accepted when
-- its repayments were not in the saved snapshot at all.
--
-- The repayments live in a JSON snapshot owned by the merchant's device, so
-- they cannot be written from inside a transaction here. What this function
-- does instead is make the claim's own change conditional on them: in one
-- transaction it locks the claim, requires it to still be pending, requires
-- the saved snapshot to already hold repayments for this batch that add up to
-- the claim, and only then marks it accepted. The app saves the repayments
-- first, calls this, and takes the repayments back out if this refuses.

CREATE OR REPLACE FUNCTION public.accept_loan_payment_claim(p_claim_id uuid, p_batch_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claim public.loan_payment_claims%ROWTYPE;
  v_saved numeric;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_batch_id IS NULL OR btrim(p_batch_id) = '' THEN
    RAISE EXCEPTION 'A batch id is required to accept a payment claim';
  END IF;

  SELECT * INTO v_claim FROM public.loan_payment_claims WHERE id = p_claim_id FOR UPDATE;
  IF NOT FOUND OR v_claim.merchant_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Payment claim not found';
  END IF;

  -- Calling again for a claim already accepted under this very batch changes nothing.
  IF v_claim.status = 'accepted' AND v_claim.applied_batch_id = p_batch_id THEN
    RETURN;
  END IF;
  IF v_claim.status <> 'pending' THEN
    RAISE EXCEPTION 'This payment claim was already %', v_claim.status;
  END IF;

  SELECT COALESCE(SUM((r->>'amount')::numeric), 0) INTO v_saved
  FROM public.tracker_snapshots s,
       jsonb_array_elements(COALESCE(s.state->'customerLoans', '[]'::jsonb)) l,
       jsonb_array_elements(COALESCE(l->'repayments', '[]'::jsonb)) r
  WHERE s.user_id = auth.uid()
    AND r->>'batchId' = p_batch_id
    AND l->>'currency' = v_claim.currency;

  IF abs(v_saved - v_claim.amount) > 0.01 THEN
    RAISE EXCEPTION 'The repayment for this claim is not saved yet (saved %, claimed %)', v_saved, v_claim.amount;
  END IF;

  UPDATE public.loan_payment_claims
     SET status = 'accepted', reviewed_at = now(), applied_batch_id = p_batch_id
   WHERE id = p_claim_id;
END;
$$;

REVOKE ALL ON FUNCTION public.accept_loan_payment_claim(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_loan_payment_claim(uuid, text) TO authenticated;
