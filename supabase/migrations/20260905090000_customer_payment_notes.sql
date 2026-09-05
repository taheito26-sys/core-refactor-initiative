-- Lets a customer attach their own note to a payment shown on their
-- read-only loan statement (customer-loan-statement edge function). The
-- payment itself lives in the merchant's tracker snapshot and is never
-- writable by the customer — this table stores an independent annotation
-- keyed by a stable fingerprint of the payment (currency:date:amount),
-- entirely separate from the merchant's own payment note.
CREATE TABLE public.customer_payment_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  payment_key text NOT NULL,
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, payment_key)
);

ALTER TABLE public.customer_payment_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Customers manage own payment notes"
  ON public.customer_payment_notes FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_customer_payment_notes_updated_at
  BEFORE UPDATE ON public.customer_payment_notes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
