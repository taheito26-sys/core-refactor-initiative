
CREATE TABLE public.tracker_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  state jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);

ALTER TABLE public.tracker_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own tracker state"
  ON public.tracker_snapshots FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own tracker state"
  ON public.tracker_snapshots FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own tracker state"
  ON public.tracker_snapshots FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);
