-- Money lent by hand to people who are not customers (a friend, a relative).
-- Kept apart from customer loans, which belong to an order. Repayments are a
-- JSON array of { id, ts, amount, note } so a loan can be repaid in parts.
CREATE TABLE IF NOT EXISTS public.personal_loans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id) ON DELETE CASCADE,
  person text NOT NULL,
  principal numeric NOT NULL CHECK (principal > 0),
  currency text NOT NULL CHECK (currency IN ('QAR', 'USD', 'EGP', 'USDT')),
  lent_at timestamptz NOT NULL DEFAULT now(),
  note text,
  ledger_entry_id text,
  repayments jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS personal_loans_user_idx ON public.personal_loans (user_id);

ALTER TABLE public.personal_loans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own personal loans" ON public.personal_loans
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Users insert own personal loans" ON public.personal_loans
  FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users update own personal loans" ON public.personal_loans
  FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users delete own personal loans" ON public.personal_loans
  FOR DELETE USING (user_id = auth.uid());
