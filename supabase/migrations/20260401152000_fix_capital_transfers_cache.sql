-- Fix: Ensure capital_transfers table exists, update merchant_deals constraints, and refresh schema cache.
-- This resolved the "Could not find the table 'public.capital_transfers' in the schema cache" error.

-- 1. Ensure capital_transfers table exists with correct schema
CREATE TABLE IF NOT EXISTS public.capital_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES public.merchant_deals(id) ON DELETE CASCADE,
  relationship_id UUID NOT NULL REFERENCES public.merchant_relationships(id),

  direction TEXT NOT NULL CHECK (direction IN ('lender_to_operator', 'operator_to_lender')),
  amount DECIMAL NOT NULL,
  cost_basis DECIMAL NOT NULL,
  total_cost DECIMAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USDT',

  transferred_by UUID NOT NULL REFERENCES auth.users(id),
  note TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Update merchant_deals check constraint to allow 'capital_transfer' as a valid deal_type
DO $$
BEGIN
    ALTER TABLE public.merchant_deals DROP CONSTRAINT IF EXISTS merchant_deals_deal_type_check;
    ALTER TABLE public.merchant_deals ADD CONSTRAINT merchant_deals_deal_type_check 
      CHECK (deal_type IN ('loan', 'investment', 'general', 'capital_transfer', 'profit_share'));
EXCEPTION
    WHEN others THEN
        NULL;
END $$;

-- 3. Ensure RLS is active and policies are present
ALTER TABLE public.capital_transfers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Relationship members can view capital transfers" ON public.capital_transfers;
CREATE POLICY "Relationship members can view capital transfers"
  ON public.capital_transfers FOR SELECT
  USING (public.is_relationship_member(relationship_id));

DROP POLICY IF EXISTS "Relationship members can create capital transfers" ON public.capital_transfers;
CREATE POLICY "Relationship members can create capital transfers"
  ON public.capital_transfers FOR INSERT
  WITH CHECK (public.is_relationship_member(relationship_id) AND auth.uid() = transferred_by);

-- 4. Enable Realtime for the table
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' 
        AND schemaname = 'public' 
        AND tablename = 'capital_transfers'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.capital_transfers;
    END IF;
EXCEPTION
    WHEN others THEN
        NULL;
END $$;

-- 5. Force PostgREST to reload the schema cache
NOTIFY pgrst, 'reload schema';
