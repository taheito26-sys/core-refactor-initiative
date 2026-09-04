-- Lets a merchant attach a shareable buyer statement link to a specific
-- signed-in customer portal account, so that customer can view their own
-- loan statement in-app (via the customer-loan-statement edge function)
-- instead of needing the token URL sent to them out-of-band.
ALTER TABLE public.buyer_statement_links
  ADD COLUMN IF NOT EXISTS customer_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS buyer_statement_links_customer_user_id_idx
  ON public.buyer_statement_links (customer_user_id)
  WHERE revoked_at IS NULL;

-- Customers only need to know which of their connected merchants they're
-- linked to (for the picker) — not the token or any other buyer's row.
-- customer-loan-statement itself reads with the service-role key, so this
-- policy exists for the merchant-side picker UI, not the statement fetch.
CREATE POLICY "Customers can view own linked statement links"
  ON public.buyer_statement_links FOR SELECT
  TO authenticated
  USING (auth.uid() = customer_user_id);
