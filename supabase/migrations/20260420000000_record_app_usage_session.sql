-- Record app usage sessions through a security-definer RPC so the browser
-- does not need direct INSERT/UPDATE privileges on the table.
CREATE OR REPLACE FUNCTION public.record_app_usage_session(
  p_user_id UUID,
  p_session_id TEXT,
  p_platform TEXT DEFAULT 'web',
  p_app_version TEXT DEFAULT NULL,
  p_last_seen_at TIMESTAMPTZ DEFAULT now()
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RETURN;
  END IF;

  INSERT INTO public.app_usage_sessions (
    user_id,
    session_id,
    platform,
    app_version,
    first_seen_at,
    last_seen_at,
    updated_at
  )
  VALUES (
    p_user_id,
    p_session_id,
    COALESCE(NULLIF(p_platform, ''), 'web'),
    p_app_version,
    p_last_seen_at,
    p_last_seen_at,
    p_last_seen_at
  )
  ON CONFLICT (session_id)
  DO UPDATE SET
    user_id = EXCLUDED.user_id,
    platform = EXCLUDED.platform,
    app_version = EXCLUDED.app_version,
    last_seen_at = EXCLUDED.last_seen_at,
    updated_at = EXCLUDED.updated_at
  WHERE public.app_usage_sessions.user_id = auth.uid();
END;
$$;

REVOKE ALL ON FUNCTION public.record_app_usage_session(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_app_usage_session(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ) TO authenticated;
