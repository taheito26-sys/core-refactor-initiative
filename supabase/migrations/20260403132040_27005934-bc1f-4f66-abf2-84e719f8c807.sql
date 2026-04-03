
ALTER TABLE public.cash_accounts
ADD COLUMN IF NOT EXISTS is_merchant_account BOOLEAN DEFAULT FALSE;

ALTER TABLE public.cash_ledger
ADD COLUMN IF NOT EXISTS batch_id TEXT;
