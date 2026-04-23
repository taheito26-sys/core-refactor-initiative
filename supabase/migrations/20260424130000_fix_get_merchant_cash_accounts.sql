-- Fix get_merchant_cash_accounts: id column is text, not uuid
-- Must DROP first because return type changes (PostgreSQL restriction)

DROP FUNCTION IF EXISTS public.get_merchant_cash_accounts(text);

CREATE FUNCTION public.get_merchant_cash_accounts(p_merchant_id text)
RETURNS TABLE (
  id text,
  user_id uuid,
  name text,
  currency text,
  type text,
  status text,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    ca.id,
    ca.user_id,
    ca.name,
    ca.currency,
    ca.type,
    ca.status,
    ca.created_at,
    ca.updated_at
  FROM public.cash_accounts ca
  INNER JOIN public.merchant_profiles mp ON ca.user_id = mp.user_id
  WHERE mp.merchant_id = p_merchant_id
  AND ca.status = 'active'
  ORDER BY ca.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_merchant_cash_accounts(text) TO authenticated;

NOTIFY pgrst, 'reload schema';
