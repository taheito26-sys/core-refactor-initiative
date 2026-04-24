-- Fix cash_accounts.id column: ensure it has a default so inserts without id don't fail.
-- The table was originally created with id text (not uuid), so gen_random_uuid() default
-- from later migrations never applied. We set a nanoid-style default using substr(md5(random()::text),1,8).

ALTER TABLE public.cash_accounts
  ALTER COLUMN id SET DEFAULT substr(md5(random()::text), 1, 8);

NOTIFY pgrst, 'reload schema';
