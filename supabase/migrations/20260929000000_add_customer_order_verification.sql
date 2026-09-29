-- Add customer order verification/confirmation workflow
-- Customers verify received funds and confirm correctness

-- 1. Add verification columns to customer_orders
ALTER TABLE public.customer_orders ADD COLUMN IF NOT EXISTS verification_status text DEFAULT 'pending';
-- pending: waiting for customer to verify, verified: customer confirmed receipt, failed: funds not received

ALTER TABLE public.customer_orders ADD COLUMN IF NOT EXISTS verified_at timestamptz;
ALTER TABLE public.customer_orders ADD COLUMN IF NOT EXISTS verified_by_user_id uuid;
ALTER TABLE public.customer_orders ADD COLUMN IF NOT EXISTS verification_notes text;
ALTER TABLE public.customer_orders ADD COLUMN IF NOT EXISTS amount_received numeric; -- what customer actually received
ALTER TABLE public.customer_orders ADD COLUMN IF NOT EXISTS bank_reference text; -- bank transaction reference
ALTER TABLE public.customer_orders ADD COLUMN IF NOT EXISTS is_amount_correct boolean DEFAULT NULL; -- true if correct, false if mismatch

-- 2. Add constraint for valid verification status
ALTER TABLE public.customer_orders ADD CONSTRAINT chk_verification_status
  CHECK (verification_status IN ('pending', 'verified', 'failed', 'partial'));

-- 3. Create RPC function for customer to verify order receipt
CREATE OR REPLACE FUNCTION public.verify_customer_order_receipt(
  p_order_id uuid,
  p_is_amount_correct boolean,
  p_amount_received numeric,
  p_bank_reference text,
  p_verification_notes text
)
RETURNS public.customer_orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.customer_orders;
  v_user_id uuid;
BEGIN
  -- Get current user
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Get and verify order
  SELECT * INTO v_order FROM public.customer_orders
  WHERE id = p_order_id AND customer_user_id = v_user_id;

  IF v_order IS NULL THEN
    RAISE EXCEPTION 'Order not found or not authorized';
  END IF;

  -- Order must be approved before verification
  IF v_order.workflow_status != 'approved' THEN
    RAISE EXCEPTION 'Order must be approved before verification';
  END IF;

  -- Update with verification data
  UPDATE public.customer_orders SET
    verification_status = CASE
      WHEN p_is_amount_correct THEN 'verified'
      WHEN p_is_amount_correct = false THEN 'failed'
      ELSE 'pending'
    END,
    verified_at = now(),
    verified_by_user_id = v_user_id,
    verification_notes = p_verification_notes,
    amount_received = p_amount_received,
    bank_reference = p_bank_reference,
    is_amount_correct = p_is_amount_correct
  WHERE id = p_order_id
  RETURNING * INTO v_order;

  RETURN v_order;
END;
$$;

-- 4. Create index for verification queries
CREATE INDEX IF NOT EXISTS idx_customer_orders_verification
  ON public.customer_orders(customer_user_id, verification_status);

-- 5. Create audit log table for verification changes
CREATE TABLE IF NOT EXISTS public.customer_order_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.customer_orders(id) ON DELETE CASCADE,
  customer_user_id uuid NOT NULL,
  verification_status text NOT NULL,
  is_amount_correct boolean,
  amount_received numeric,
  bank_reference text,
  verification_notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.customer_order_verifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Customers can view own verification history"
  ON public.customer_order_verifications FOR SELECT
  USING (customer_user_id = auth.uid());

CREATE POLICY "Merchants can view customer verification history"
  ON public.customer_order_verifications FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.customer_orders
      WHERE id = order_id AND merchant_id = public.current_merchant_id()
    )
  );

-- 6. Trigger to log verification changes
CREATE OR REPLACE FUNCTION public.log_order_verification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Only log when verification fields change
  IF (OLD.verification_status IS DISTINCT FROM NEW.verification_status) OR
     (OLD.is_amount_correct IS DISTINCT FROM NEW.is_amount_correct) THEN
    INSERT INTO public.customer_order_verifications (
      order_id, customer_user_id, verification_status, is_amount_correct,
      amount_received, bank_reference, verification_notes
    ) VALUES (
      NEW.id, NEW.customer_user_id, NEW.verification_status, NEW.is_amount_correct,
      NEW.amount_received, NEW.bank_reference, NEW.verification_notes
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS log_order_verification ON public.customer_orders;
CREATE TRIGGER log_order_verification
  AFTER UPDATE ON public.customer_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.log_order_verification();

-- 7. Grant permissions
GRANT EXECUTE ON FUNCTION public.verify_customer_order_receipt(uuid, boolean, numeric, text, text)
  TO authenticated;

COMMENT ON COLUMN public.customer_orders.verification_status IS
  'pending: awaiting customer verification, verified: customer confirmed receipt and amount correct, failed: customer reports amount mismatch or funds not received, partial: partial amount received';

COMMENT ON COLUMN public.customer_orders.is_amount_correct IS
  'true: customer confirms amount received matches order, false: customer reports discrepancy, NULL: not yet verified';
