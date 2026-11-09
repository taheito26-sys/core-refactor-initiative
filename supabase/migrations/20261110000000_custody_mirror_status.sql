-- Custody accounts are one ledger per merchant, linked only by request/accept, so cash the
-- custodian adds directly never reached the other side. This returns, for each of the
-- caller's custody accounts, who holds the cash and what the holder's account totals, so the
-- non-holder's account can mirror it. The holder is the custodian of the relationship's most
-- recently accepted custody request. Reads only the caller's own relationships.
CREATE OR REPLACE FUNCTION public.custody_mirror_status()
RETURNS TABLE (
  account_id text,
  relationship_id uuid,
  role text,
  source_account_id text,
  source_balance numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_merchant text := public.current_merchant_id();
BEGIN
  IF auth.uid() IS NULL OR v_merchant IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH mine AS (
    SELECT a.id AS acc_id, a.currency AS cur,
           (regexp_match(a.notes, 'relationshipId%22%3A%22([0-9a-fA-F-]{36})'))[1]::uuid AS rel
    FROM public.cash_accounts a
    WHERE a.user_id = auth.uid()
      AND a.is_merchant_account
      AND a.status = 'active'
      AND a.notes ~ 'relationshipId%22%3A%22[0-9a-fA-F-]{36}'
  ), linked AS (
    SELECT m.acc_id, m.cur, m.rel,
           CASE WHEN r.merchant_a_id = v_merchant THEN r.merchant_b_id ELSE r.merchant_a_id END AS other_merchant
    FROM mine m
    JOIN public.merchant_relationships r ON r.id = m.rel
    WHERE v_merchant IN (r.merchant_a_id, r.merchant_b_id)
  ), holder AS (
    SELECT DISTINCT ON (q.relationship_id) q.relationship_id AS rel, q.custodian_merchant_id AS custodian
    FROM public.cash_custody_requests q
    WHERE q.status = 'accepted'
      AND q.relationship_id IN (SELECT l.rel FROM linked l)
    ORDER BY q.relationship_id, q.accepted_at DESC NULLS LAST
  )
  SELECT l.acc_id,
         l.rel,
         CASE WHEN h.custodian = v_merchant THEN 'holder' ELSE 'mirror' END,
         b.id,
         COALESCE((
           SELECT SUM(CASE WHEN e.direction = 'in' THEN e.amount ELSE -e.amount END)
           FROM public.cash_ledger e
           WHERE e.account_id = b.id AND e.user_id = b.user_id
         ), 0)
  FROM linked l
  JOIN holder h ON h.rel = l.rel
  JOIN LATERAL (
    SELECT p.user_id FROM public.merchant_profiles p WHERE p.merchant_id = l.other_merchant LIMIT 1
  ) op ON true
  JOIN public.cash_accounts b
    ON b.user_id = op.user_id
   AND b.is_merchant_account
   AND b.status = 'active'
   AND b.currency = l.cur
   AND b.notes LIKE '%' || l.rel::text || '%';
END;
$$;

GRANT EXECUTE ON FUNCTION public.custody_mirror_status() TO authenticated;
