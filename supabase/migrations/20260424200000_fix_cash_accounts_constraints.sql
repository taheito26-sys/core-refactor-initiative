-- Fix cash_accounts constraints to allow EGP currency and additional account types.
-- Current constraints only allow: currency IN (QAR, USDT, USD), type IN (hand, bank, vault)

-- Drop and recreate currency constraint with EGP added
ALTER TABLE public.cash_accounts DROP CONSTRAINT IF EXISTS cash_accounts_currency_check;
ALTER TABLE public.cash_accounts ADD CONSTRAINT cash_accounts_currency_check
  CHECK (currency = ANY (ARRAY['QAR'::text, 'EGP'::text, 'USDT'::text, 'USD'::text, 'AED'::text, 'SAR'::text]));

-- Drop and recreate type constraint with mobile_wallet and other added
ALTER TABLE public.cash_accounts DROP CONSTRAINT IF EXISTS cash_accounts_type_check;
ALTER TABLE public.cash_accounts ADD CONSTRAINT cash_accounts_type_check
  CHECK (type = ANY (ARRAY['hand'::text, 'bank'::text, 'vault'::text, 'mobile_wallet'::text, 'other'::text]));

NOTIFY pgrst, 'reload schema';
