-- Reload PostgREST schema cache after RPC fixes
-- The v2 fix for get_merchant_cash_accounts changed the return type
-- This ensures PostgREST loads the latest function definition

NOTIFY pgrst, 'reload schema';
