-- Daily WACOP reference rate snapshots
CREATE TABLE public.daily_reference_rates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  rate_date DATE NOT NULL,
  wacop_rate NUMERIC NOT NULL,
  total_usdt_stock NUMERIC NOT NULL DEFAULT 0,
  total_cost_basis_qar NUMERIC NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'fifo_wacop',
  recorded_by UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (rate_date, recorded_by)
);

ALTER TABLE public.daily_reference_rates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own reference rates"
ON public.daily_reference_rates
FOR SELECT
USING (auth.uid() = recorded_by);

CREATE POLICY "Users can insert own reference rates"
ON public.daily_reference_rates
FOR INSERT
WITH CHECK (auth.uid() = recorded_by);

CREATE POLICY "Users can update own reference rates"
ON public.daily_reference_rates
FOR UPDATE
USING (auth.uid() = recorded_by);

CREATE INDEX idx_daily_reference_rates_date ON public.daily_reference_rates (recorded_by, rate_date DESC);