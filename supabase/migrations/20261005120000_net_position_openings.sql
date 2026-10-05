-- Opening net positions entered by hand. The records may not reach back far
-- enough, or may be wrong, so a merchant can state what each line really was
-- at the start of a month. `offsets` is the difference from the records,
-- applied to that month and every later one until another month is set.
CREATE TABLE IF NOT EXISTS public.net_position_openings (
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id) ON DELETE CASCADE,
  month text NOT NULL CHECK (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  manual jsonb NOT NULL,
  offsets jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, month)
);

ALTER TABLE public.net_position_openings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own position openings" ON public.net_position_openings
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Users insert own position openings" ON public.net_position_openings
  FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users update own position openings" ON public.net_position_openings
  FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users delete own position openings" ON public.net_position_openings
  FOR DELETE USING (user_id = auth.uid());
