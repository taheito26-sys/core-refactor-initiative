-- Create RPC to delete customer (admin only)
-- Deletes: customer_profiles, customer_merchant_connections
-- Preserves: orders, stock
CREATE OR REPLACE FUNCTION public.delete_customer_by_admin(p_user_id UUID)
RETURNS JSON AS $$
BEGIN
  -- Delete customer_merchant_connections first (FK reference)
  DELETE FROM public.customer_merchant_connections WHERE customer_user_id = p_user_id;
  
  -- Delete customer_profiles
  DELETE FROM public.customer_profiles WHERE user_id = p_user_id;
  
  RETURN JSON_BUILD_OBJECT(
    'success', true,
    'message', 'Customer data deleted successfully (profile & connections)',
    'user_id', p_user_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Grant execute to authenticated users (RLS policies will handle admin check)
GRANT EXECUTE ON FUNCTION public.delete_customer_by_admin(UUID) TO authenticated;
