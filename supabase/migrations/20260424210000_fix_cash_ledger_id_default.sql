-- Fix cash_ledger.id: text column with no default, same pattern as cash_accounts.
-- Set a short random text default as safety net.

ALTER TABLE public.cash_ledger
  ALTER COLUMN id SET DEFAULT substr(md5(random()::text), 1, 8);

NOTIFY pgrst, 'reload schema';
