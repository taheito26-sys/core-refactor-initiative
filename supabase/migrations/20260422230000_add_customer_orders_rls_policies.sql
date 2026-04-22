-- Add RLS policies for customer_orders table to ensure proper visibility

-- 1. Enable RLS on customer_orders if not already enabled
ALTER TABLE public.customer_orders ENABLE ROW LEVEL SECURITY;

-- 2. Drop existing policies if they exist (to avoid duplicates)
DROP POLICY IF EXISTS "Merchants can view their own orders" ON public.customer_orders;
DROP POLICY IF EXISTS "Customers can view their own orders" ON public.customer_orders;

-- 3. Create policies for merchants to view their orders
CREATE POLICY "Merchants can view their own orders" ON public.customer_orders
  FOR SELECT USING (
    merchant_id = public.current_merchant_id()
  );

-- 4. Create policies for customers to view their orders
CREATE POLICY "Customers can view their own orders" ON public.customer_orders
  FOR SELECT USING (
    customer_user_id = auth.uid()
  );

-- 5. Merchants can create orders (via RPC, but need insert policy too)
CREATE POLICY "RPC can create orders" ON public.customer_orders
  FOR INSERT WITH CHECK (true);

-- 6. Allow updates via RPC for approved orders
CREATE POLICY "RPC can update orders" ON public.customer_orders
  FOR UPDATE USING (true);

-- Notify about migration
NOTIFY pgrst, 'reload schema';
