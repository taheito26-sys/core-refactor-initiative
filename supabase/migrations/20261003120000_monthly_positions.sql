-- Frozen month-end net position snapshots. A month's position is rebuilt
-- from dated records, so editing an old record would move a month that was
-- already closed; closing a month saves its figures as they stood.
-- One row per user per month. `position` and `bridge` hold the computed
-- figures exactly as the Net Position page showed them when it was closed.
CREATE TABLE IF NOT EXISTS public.monthly_positions (
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id) ON DELETE CASCADE,
  month text NOT NULL CHECK (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  frozen boolean NOT NULL DEFAULT true,
  closed_at timestamptz NOT NULL DEFAULT now(),
  reopened_at timestamptz,
  reopen_count integer NOT NULL DEFAULT 0,
  position jsonb NOT NULL,
  bridge jsonb NOT NULL,
  rates jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (user_id, month)
);

ALTER TABLE public.monthly_positions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own monthly positions" ON public.monthly_positions
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Users insert own monthly positions" ON public.monthly_positions
  FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users update own monthly positions" ON public.monthly_positions
  FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users delete own monthly positions" ON public.monthly_positions
  FOR DELETE USING (user_id = auth.uid());
