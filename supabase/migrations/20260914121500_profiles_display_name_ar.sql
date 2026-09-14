-- Lets a customer set an Arabic name alongside their existing display_name,
-- so the portal can show whichever matches the active UI language instead
-- of always showing one name regardless of the language toggle. No RLS
-- change needed — the existing "Customers can update own profile" policy
-- already covers every column on the row.
alter table public.customer_profiles
  add column if not exists display_name_ar text;
