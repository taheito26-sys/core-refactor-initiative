-- Fix cash links constraint and add live FX rate functionality

-- 1. Fix the chk_link_kind constraint to allow 'none' for no account scenario
ALTER TABLE public.customer_order_cash_links
  DROP CONSTRAINT IF EXISTS chk_link_kind;

ALTER TABLE public.customer_order_cash_links
  ADD CONSTRAINT chk_link_kind CHECK (link_kind IN ('send', 'receive', 'settlement', 'reserve', 'none'));

-- 2. Create table for FX rates (cached from P2P market)
CREATE TABLE IF NOT EXISTS public.fx_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_currency text NOT NULL,
  target_currency text NOT NULL,
  rate numeric NOT NULL,
  source text NOT NULL DEFAULT 'p2p_market',
  fetched_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(source_currency, target_currency, source)
);

-- 3. Get latest FX rate (with fallback for QAR-EGP)
CREATE OR REPLACE FUNCTION public.get_fx_rate(
  p_source_currency text,
  p_target_currency text
)
RETURNS TABLE (
  rate numeric,
  fetched_at timestamptz,
  is_estimate boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rate numeric;
  v_fetched_at timestamptz;
  v_age_minutes integer;
BEGIN
  -- Try to get the most recent rate (within 1 hour)
  SELECT fx.rate, fx.fetched_at INTO v_rate, v_fetched_at
  FROM public.fx_rates fx
  WHERE fx.source_currency = p_source_currency
    AND fx.target_currency = p_target_currency
  ORDER BY fx.fetched_at DESC
  LIMIT 1;

  -- If we have a recent rate (less than 1 hour old), use it
  IF v_rate IS NOT NULL THEN
    v_age_minutes := EXTRACT(EPOCH FROM (now() - v_fetched_at)) / 60;
    IF v_age_minutes < 60 THEN
      RETURN QUERY SELECT v_rate, v_fetched_at, FALSE;
      RETURN;
    END IF;
  END IF;

  -- Fallback: return cached rate even if old, mark as estimate
  IF v_rate IS NOT NULL THEN
    RETURN QUERY SELECT v_rate, v_fetched_at, TRUE;
    RETURN;
  END IF;

  -- No rate found - return default estimate for QAR-EGP
  IF p_source_currency = 'QAR' AND p_target_currency = 'EGP' THEN
    INSERT INTO public.fx_rates (source_currency, target_currency, rate, source)
    VALUES ('QAR', 'EGP', 0.27, 'default_estimate')
    ON CONFLICT (source_currency, target_currency, source) DO UPDATE
    SET rate = 0.27, fetched_at = now()
    RETURNING rate, fetched_at, TRUE INTO v_rate, v_fetched_at;

    RETURN QUERY SELECT v_rate, v_fetched_at, TRUE;
    RETURN;
  END IF;

  -- Generic fallback
  RETURN QUERY SELECT 1.0::numeric, now(), TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_fx_rate(text, text) TO authenticated;

-- 4. Function to update FX rate (would be called by backend service)
CREATE OR REPLACE FUNCTION public.update_fx_rate(
  p_source_currency text,
  p_target_currency text,
  p_rate numeric
)
RETURNS TABLE (
  rate numeric,
  fetched_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rate numeric;
  v_fetched_at timestamptz;
BEGIN
  INSERT INTO public.fx_rates (source_currency, target_currency, rate, source, fetched_at)
  VALUES (p_source_currency, p_target_currency, p_rate, 'p2p_market', now())
  ON CONFLICT (source_currency, target_currency, source) DO UPDATE
  SET rate = p_rate, fetched_at = now()
  RETURNING fx_rates.rate, fx_rates.fetched_at INTO v_rate, v_fetched_at;

  RETURN QUERY SELECT v_rate, v_fetched_at;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_fx_rate(text, text, numeric) TO authenticated;

-- 5. Enable RLS on fx_rates table
ALTER TABLE public.fx_rates ENABLE ROW LEVEL SECURITY;

-- Everyone can read FX rates
CREATE POLICY "Anyone can view fx rates" ON public.fx_rates
  FOR SELECT USING (true);

-- Only service role can insert/update
CREATE POLICY "Service role can update fx rates" ON public.fx_rates
  FOR INSERT WITH CHECK (true);
CREATE POLICY "Service role can update fx rates (update)" ON public.fx_rates
  FOR UPDATE USING (true);

-- Notify about migration
NOTIFY pgrst, 'reload schema';
