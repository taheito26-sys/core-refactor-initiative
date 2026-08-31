-- Public, token-based, read-only statement links for one buyer at a time.
-- The public edge function reads this table with the service-role key, so
-- there is deliberately no anon SELECT policy here.
CREATE TABLE public.buyer_statement_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  customer_id text NOT NULL,
  token text NOT NULL UNIQUE,
  currency text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

ALTER TABLE public.buyer_statement_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own statement links"
  ON public.buyer_statement_links FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX buyer_statement_links_user_id_idx ON public.buyer_statement_links (user_id);
CREATE INDEX buyer_statement_links_token_idx ON public.buyer_statement_links (token) WHERE revoked_at IS NULL;
