
-- Order events timeline table
CREATE TABLE public.customer_order_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.customer_orders(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  actor_user_id uuid NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.customer_order_events ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_customer_order_events_order ON public.customer_order_events(order_id);

CREATE POLICY "Customers can view own order events"
  ON public.customer_order_events FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.customer_orders o
    WHERE o.id = customer_order_events.order_id AND o.customer_user_id = auth.uid()
  ));

CREATE POLICY "Merchants can view order events"
  ON public.customer_order_events FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.customer_orders o
    WHERE o.id = customer_order_events.order_id AND o.merchant_id = current_merchant_id()
  ));

CREATE POLICY "Admins can view all order events"
  ON public.customer_order_events FOR SELECT
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Authenticated users can insert order events"
  ON public.customer_order_events FOR INSERT
  WITH CHECK (auth.uid() = actor_user_id AND EXISTS (
    SELECT 1 FROM public.customer_orders o
    WHERE o.id = customer_order_events.order_id
    AND (o.customer_user_id = auth.uid() OR o.merchant_id = current_merchant_id())
  ));

-- Add lifecycle columns to customer_orders
ALTER TABLE public.customer_orders
  ADD COLUMN IF NOT EXISTS payment_proof_url text,
  ADD COLUMN IF NOT EXISTS payment_proof_uploaded_at timestamptz,
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

-- Storage bucket for payment proofs
INSERT INTO storage.buckets (id, name, public) VALUES ('payment-proofs', 'payment-proofs', false);

CREATE POLICY "Customers upload own payment proofs"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'payment-proofs' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Customers view own payment proofs"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'payment-proofs' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Merchants view payment proofs for their orders"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'payment-proofs' AND EXISTS (
    SELECT 1 FROM public.customer_orders o
    WHERE o.merchant_id = current_merchant_id()
    AND o.payment_proof_url LIKE '%' || storage.filename(name)
  ));
