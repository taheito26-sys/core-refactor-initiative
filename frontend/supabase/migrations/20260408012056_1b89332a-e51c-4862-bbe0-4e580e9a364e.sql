-- Admin can view all customer profiles
CREATE POLICY "Admins can view all customer profiles"
ON public.customer_profiles FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

-- Admin can view all customer connections
CREATE POLICY "Admins can view all customer connections"
ON public.customer_merchant_connections FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

-- Admin can view all customer orders
CREATE POLICY "Admins can view all customer orders"
ON public.customer_orders FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

-- Admin can view all customer messages
CREATE POLICY "Admins can view all customer messages"
ON public.customer_messages FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));