-- Auto-create customer profile for new users to prevent "no data" issues on login

-- 1. Function to ensure customer profile exists for a user
CREATE OR REPLACE FUNCTION public.ensure_customer_profile(p_user_id uuid)
RETURNS public.customer_profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile public.customer_profiles;
BEGIN
  -- Try to get existing profile
  SELECT * INTO v_profile FROM public.customer_profiles WHERE user_id = p_user_id;

  -- If no profile exists, create one
  IF v_profile IS NULL THEN
    INSERT INTO public.customer_profiles (
      user_id,
      display_name,
      display_name_ar,
      phone,
      region,
      country,
      preferred_currency,
      status,
      created_at,
      updated_at
    ) VALUES (
      p_user_id,
      '', -- Empty display name, user fills it in portal
      NULL,
      NULL,
      NULL,
      NULL,
      'USDT', -- Default currency
      'active',
      now(),
      now()
    )
    RETURNING * INTO v_profile;
  END IF;

  RETURN v_profile;
END;
$$;

-- 2. Trigger to auto-create profile on auth.users insert
CREATE OR REPLACE FUNCTION public.on_auth_user_created()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Automatically create a customer profile for new user
  PERFORM public.ensure_customer_profile(NEW.id);
  RETURN NEW;
END;
$$;

-- Drop old trigger if it exists
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- Create trigger that fires when a new user is created in auth.users
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.on_auth_user_created();

-- 3. Verify and fix any existing users without profiles
-- This handles users who signed up before this migration
INSERT INTO public.customer_profiles (user_id, display_name, display_name_ar, phone, region, country, preferred_currency, status, created_at, updated_at)
SELECT
  u.id,
  COALESCE(NULLIF(u.raw_user_meta_data->>'display_name', ''), ''),
  NULL,
  NULL,
  NULL,
  NULL,
  'USDT',
  'active',
  now(),
  now()
FROM auth.users u
WHERE NOT EXISTS (SELECT 1 FROM public.customer_profiles cp WHERE cp.user_id = u.id)
  AND u.created_at > now() - interval '30 days' -- Only recent users
ON CONFLICT (user_id) DO NOTHING;

-- 4. Add index for better query performance when ensuring profile exists
CREATE INDEX IF NOT EXISTS idx_customer_profiles_user_id ON public.customer_profiles(user_id);

-- 5. Expose the function as an RPC for app to call on login
GRANT EXECUTE ON FUNCTION public.ensure_customer_profile(uuid) TO authenticated;
