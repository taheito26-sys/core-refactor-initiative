-- App-wide configuration key-value store for admin toggles
CREATE TABLE IF NOT EXISTS public.app_config (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT 'true'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;

-- Everyone can read config
CREATE POLICY "Anyone can read app config" ON public.app_config
  FOR SELECT USING (true);

-- Only admins can write
CREATE POLICY "Admins can manage app config" ON public.app_config
  FOR ALL USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
  ) WITH CHECK (
    public.has_role(auth.uid(), 'admin'::public.app_role)
  );

-- Seed default: welcome message enabled
INSERT INTO public.app_config (key, value) VALUES ('welcome_message_enabled', 'true'::jsonb)
ON CONFLICT (key) DO NOTHING;

NOTIFY pgrst, 'reload schema';
