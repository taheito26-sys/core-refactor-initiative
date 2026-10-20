-- The people a buyer hands cash through when paying the merchant in person.
-- The buyer keeps their own list and tags each payment with one of them, so
-- the payments page can tell whose cash each one was and number them per
-- person. Both tables are the buyer's own annotations: the payments
-- themselves stay in the merchant's tracker and are never written from here.
CREATE TABLE public.customer_cash_givers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX customer_cash_givers_user_name_key
  ON public.customer_cash_givers (user_id, lower(btrim(name)));

ALTER TABLE public.customer_cash_givers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Customers manage own cash givers"
  ON public.customer_cash_givers FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Which giver a payment belongs to, keyed like customer_payment_notes by the
-- payment's fingerprint (currency:date:amount). An explicit row here wins over
-- a giver the payment's note merely names.
CREATE TABLE public.customer_payment_givers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  payment_key text NOT NULL,
  giver_name text NOT NULL CHECK (length(btrim(giver_name)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, payment_key)
);

ALTER TABLE public.customer_payment_givers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Customers manage own payment givers"
  ON public.customer_payment_givers FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_customer_payment_givers_updated_at
  BEFORE UPDATE ON public.customer_payment_givers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
