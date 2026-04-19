-- Ensure app_usage_sessions table exists (idempotent migration)
-- This table tracks user app usage sessions for analytics and last-active monitoring.

CREATE TABLE IF NOT EXISTS public.app_usage_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL UNIQUE,
  platform TEXT NOT NULL DEFAULT 'web',
  app_version TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.app_usage_sessions ENABLE ROW LEVEL SECURITY;

-- Drop existing policies to recreate them
DROP POLICY IF EXISTS "Users can insert own app usage sessions" ON public.app_usage_sessions;
DROP POLICY IF EXISTS "Users can update own app usage sessions" ON public.app_usage_sessions;
DROP POLICY IF EXISTS "Admins can view all app usage sessions" ON public.app_usage_sessions;

-- Create policies
CREATE POLICY "Users can insert own app usage sessions"
  ON public.app_usage_sessions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own app usage sessions"
  ON public.app_usage_sessions FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all app usage sessions"
  ON public.app_usage_sessions FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_app_usage_sessions_user_id ON public.app_usage_sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_app_usage_sessions_last_seen_at ON public.app_usage_sessions (last_seen_at DESC);

-- Create trigger for updated_at column
DROP TRIGGER IF EXISTS update_app_usage_sessions_updated_at ON public.app_usage_sessions;
CREATE TRIGGER update_app_usage_sessions_updated_at
  BEFORE UPDATE ON public.app_usage_sessions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Add table to realtime publication for activity updates
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.app_usage_sessions;
EXCEPTION WHEN duplicate_object THEN NULL;
           WHEN undefined_object THEN NULL;
END $$;
