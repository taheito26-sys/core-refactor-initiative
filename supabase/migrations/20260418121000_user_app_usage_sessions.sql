-- Track app usage sessions so admins can see last active time and session count.

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

ALTER TABLE public.app_usage_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can insert own app usage sessions" ON public.app_usage_sessions;
CREATE POLICY "Users can insert own app usage sessions"
  ON public.app_usage_sessions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own app usage sessions" ON public.app_usage_sessions;
CREATE POLICY "Users can update own app usage sessions"
  ON public.app_usage_sessions FOR UPDATE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins can view all app usage sessions" ON public.app_usage_sessions;
CREATE POLICY "Admins can view all app usage sessions"
  ON public.app_usage_sessions FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS idx_app_usage_sessions_user_id ON public.app_usage_sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_app_usage_sessions_last_seen_at ON public.app_usage_sessions (last_seen_at DESC);

DROP TRIGGER IF EXISTS update_app_usage_sessions_updated_at ON public.app_usage_sessions;
CREATE TRIGGER update_app_usage_sessions_updated_at
  BEFORE UPDATE ON public.app_usage_sessions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
