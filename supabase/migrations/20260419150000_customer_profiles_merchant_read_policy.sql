-- Allow merchants to read connected customer profile names for their own active or pending customer connections.
DROP POLICY IF EXISTS "Merchants can view connected customer profiles" ON public.customer_profiles;

CREATE POLICY "Merchants can view connected customer profiles"
ON public.customer_profiles
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.customer_merchant_connections c
    JOIN public.merchant_profiles mp
      ON mp.merchant_id = c.merchant_id
    WHERE c.customer_user_id = public.customer_profiles.user_id
      AND mp.user_id = auth.uid()
      AND c.status IN ('pending', 'active')
  )
);
