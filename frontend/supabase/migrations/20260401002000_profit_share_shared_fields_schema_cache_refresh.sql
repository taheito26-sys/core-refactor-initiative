-- Ensure shared profit-share fields exist and refresh PostgREST schema cache.
ALTER TABLE public.profit_share_agreements
  ADD COLUMN IF NOT EXISTS invested_capital numeric NULL,
  ADD COLUMN IF NOT EXISTS settlement_way text NULL CHECK (settlement_way IN ('reinvest', 'withdraw'));

-- Force PostgREST (Supabase API) to reload schema cache so new columns are queryable immediately.
NOTIFY pgrst, 'reload schema';
