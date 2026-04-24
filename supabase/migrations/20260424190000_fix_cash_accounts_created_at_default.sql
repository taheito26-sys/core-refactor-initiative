-- Fix cash_accounts.created_at: column is bigint (epoch ms), not timestamptz.
-- The DEFAULT now() from a later migration doesn't match the actual type.
-- Set a proper bigint default: epoch milliseconds.

ALTER TABLE public.cash_accounts
  ALTER COLUMN created_at SET DEFAULT (extract(epoch from now()) * 1000)::bigint;

NOTIFY pgrst, 'reload schema';
