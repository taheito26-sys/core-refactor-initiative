-- Fix get_merchant_cash_accounts: detect actual column types and match them
-- The cash_accounts.id column type needs to match the RETURNS TABLE declaration
-- Using explicit casts to handle any type mismatch

DROP FUNCTION IF EXISTS public.get_merchant_cash_accounts(text);

CREATE FUNCTION public.get_merchant_cash_accounts(p_merchant_id text)
RETURNS TABLE (
  id text,
  user_id text,
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
    ca.id::text,
    ca.user_id::text,
    ca.name::text,
    ca.currency::text,
    ca.type::text,
    ca.status::text,
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
