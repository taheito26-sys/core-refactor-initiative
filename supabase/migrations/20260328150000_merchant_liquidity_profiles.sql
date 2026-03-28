-- Merchant liquidity publishing workspace
CREATE TABLE IF NOT EXISTS public.merchant_liquidity_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id text NOT NULL UNIQUE REFERENCES public.merchant_profiles(merchant_id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  publish_cash_enabled boolean NOT NULL DEFAULT false,
  publish_usdt_enabled boolean NOT NULL DEFAULT false,
  published_cash_amount numeric(18,2),
  published_usdt_amount numeric(18,6),
  cash_publish_mode text NOT NULL DEFAULT 'status',
  usdt_publish_mode text NOT NULL DEFAULT 'status',
  cash_range_min numeric(18,2),
  cash_range_max numeric(18,2),
  usdt_range_min numeric(18,6),
  usdt_range_max numeric(18,6),
  cash_status text NOT NULL DEFAULT 'unavailable',
  usdt_status text NOT NULL DEFAULT 'unavailable',
  reserve_buffer_cash numeric(18,2) NOT NULL DEFAULT 0,
  reserve_buffer_usdt numeric(18,6) NOT NULL DEFAULT 0,
  reserved_cash_commitments numeric(18,2) NOT NULL DEFAULT 0,
  reserved_usdt_commitments numeric(18,6) NOT NULL DEFAULT 0,
  visibility_scope text NOT NULL DEFAULT 'relationships',
  auto_sync_enabled boolean NOT NULL DEFAULT false,
  last_published_at timestamptz,
  expires_at timestamptz,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.merchant_liquidity_profiles
  ADD CONSTRAINT merchant_liquidity_cash_mode_chk CHECK (cash_publish_mode IN ('exact', 'range', 'status')),
  ADD CONSTRAINT merchant_liquidity_usdt_mode_chk CHECK (usdt_publish_mode IN ('exact', 'range', 'status')),
  ADD CONSTRAINT merchant_liquidity_cash_status_chk CHECK (cash_status IN ('available', 'limited', 'unavailable')),
  ADD CONSTRAINT merchant_liquidity_usdt_status_chk CHECK (usdt_status IN ('available', 'limited', 'unavailable')),
  ADD CONSTRAINT merchant_liquidity_visibility_chk CHECK (visibility_scope IN ('relationships', 'network')),
  ADD CONSTRAINT merchant_liquidity_status_chk CHECK (status IN ('active', 'paused', 'expired')),
  ADD CONSTRAINT merchant_liquidity_cash_range_chk CHECK (cash_range_max IS NULL OR cash_range_min IS NULL OR cash_range_max >= cash_range_min),
  ADD CONSTRAINT merchant_liquidity_usdt_range_chk CHECK (usdt_range_max IS NULL OR usdt_range_min IS NULL OR usdt_range_max >= usdt_range_min);

CREATE INDEX IF NOT EXISTS idx_merchant_liquidity_merchant ON public.merchant_liquidity_profiles(merchant_id);
CREATE INDEX IF NOT EXISTS idx_merchant_liquidity_updated ON public.merchant_liquidity_profiles(last_published_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_merchant_liquidity_scope ON public.merchant_liquidity_profiles(visibility_scope, status);

DROP TRIGGER IF EXISTS update_merchant_liquidity_profiles_updated_at ON public.merchant_liquidity_profiles;
CREATE TRIGGER update_merchant_liquidity_profiles_updated_at
  BEFORE UPDATE ON public.merchant_liquidity_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.merchant_liquidity_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mlp_select ON public.merchant_liquidity_profiles;
CREATE POLICY mlp_select ON public.merchant_liquidity_profiles
  FOR SELECT
  USING (
    auth.uid() = user_id
    OR visibility_scope = 'network'
    OR EXISTS (
      SELECT 1
      FROM public.merchant_profiles me
      JOIN public.merchant_relationships rel
        ON (
          (rel.merchant_a_id = me.merchant_id AND rel.merchant_b_id = merchant_liquidity_profiles.merchant_id)
          OR (rel.merchant_b_id = me.merchant_id AND rel.merchant_a_id = merchant_liquidity_profiles.merchant_id)
        )
      WHERE me.user_id = auth.uid()
        AND rel.status IN ('active', 'pending')
    )
  );

DROP POLICY IF EXISTS mlp_insert ON public.merchant_liquidity_profiles;
CREATE POLICY mlp_insert ON public.merchant_liquidity_profiles
  FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.merchant_profiles me
      WHERE me.user_id = auth.uid()
        AND me.merchant_id = merchant_liquidity_profiles.merchant_id
    )
  );

DROP POLICY IF EXISTS mlp_update ON public.merchant_liquidity_profiles;
CREATE POLICY mlp_update ON public.merchant_liquidity_profiles
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

ALTER PUBLICATION supabase_realtime ADD TABLE public.merchant_liquidity_profiles;

NOTIFY pgrst, 'reload schema';
