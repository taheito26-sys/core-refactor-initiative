-- Net position, redesigned from scratch.
--
-- The old design (typed opening figures, frozen months, offsets) is removed with
-- its data. The new one keeps only:
--   * which cash and bank accounts the merchant counts, plus the two rates they type;
--   * one saved reading of the position per day, so a month's opening and
--     closing come from real saved days.
-- Customer loans come from the system, personal loans keep their own table.

DROP TABLE IF EXISTS public.monthly_positions;
DROP TABLE IF EXISTS public.net_position_openings;

CREATE TABLE IF NOT EXISTS public.net_position_settings (
  user_id uuid PRIMARY KEY DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  included_accounts text[] NOT NULL DEFAULT '{}',
  usd_rate numeric,
  egp_rate numeric,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.net_position_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own net position settings select" ON public.net_position_settings;
CREATE POLICY "own net position settings select" ON public.net_position_settings
  FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS "own net position settings insert" ON public.net_position_settings;
CREATE POLICY "own net position settings insert" ON public.net_position_settings
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "own net position settings update" ON public.net_position_settings;
CREATE POLICY "own net position settings update" ON public.net_position_settings
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- One row per day (Qatar day): the position as last saved that day, in QAR.
CREATE TABLE IF NOT EXISTS public.net_position_days (
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  day date NOT NULL,
  lines jsonb NOT NULL DEFAULT '{}'::jsonb,
  net numeric NOT NULL DEFAULT 0,
  saved_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, day)
);

ALTER TABLE public.net_position_days ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own net position days select" ON public.net_position_days;
CREATE POLICY "own net position days select" ON public.net_position_days
  FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS "own net position days insert" ON public.net_position_days;
CREATE POLICY "own net position days insert" ON public.net_position_days
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "own net position days update" ON public.net_position_days;
CREATE POLICY "own net position days update" ON public.net_position_days
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "own net position days delete" ON public.net_position_days;
CREATE POLICY "own net position days delete" ON public.net_position_days
  FOR DELETE TO authenticated USING (user_id = auth.uid());
