-- The login name a customer signs into the portal with, stored on the
-- merchant's connection so the merchant can see and search it. The name lives
-- in auth.users, which a merchant session cannot read.
ALTER TABLE public.customer_merchant_connections
  ADD COLUMN IF NOT EXISTS portal_username text;

-- Backfill merchant-created logins: their email is <username>@customers.local.
UPDATE public.customer_merchant_connections c
SET portal_username = COALESCE(u.raw_user_meta_data->>'username', split_part(u.email, '@', 1))
FROM auth.users u
WHERE u.id = c.customer_user_id
  AND c.portal_username IS NULL
  AND u.raw_user_meta_data->>'portal' = 'customer';

NOTIFY pgrst, 'reload schema';
