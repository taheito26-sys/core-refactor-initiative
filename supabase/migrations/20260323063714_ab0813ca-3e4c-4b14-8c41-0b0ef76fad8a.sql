-- Task 2 fix: Drop existing admin policy first then recreate
DROP POLICY IF EXISTS "Admins can view all merchant profiles" ON public.merchant_profiles;

-- Add discoverability column
ALTER TABLE public.merchant_profiles
  ADD COLUMN IF NOT EXISTS discoverability TEXT NOT NULL DEFAULT 'public';

-- Validation trigger
CREATE OR REPLACE FUNCTION public.validate_discoverability()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.discoverability NOT IN ('public', 'merchant_id_only', 'hidden') THEN
    RAISE EXCEPTION 'Invalid discoverability value: %', NEW.discoverability;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_discoverability ON public.merchant_profiles;
CREATE TRIGGER trg_validate_discoverability
  BEFORE INSERT OR UPDATE ON public.merchant_profiles
  FOR EACH ROW EXECUTE FUNCTION public.validate_discoverability();

-- Drop old policies
DROP POLICY IF EXISTS "Merchant profiles are viewable by authenticated users" ON public.merchant_profiles;
DROP POLICY IF EXISTS "Merchant profiles visibility by discoverability" ON public.merchant_profiles;

-- Relationship check function
CREATE OR REPLACE FUNCTION public.has_relationship_with(_viewer_merchant_id TEXT, _target_merchant_id TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.merchant_relationships r
    WHERE r.status = 'active'
    AND ((r.merchant_a_id = _viewer_merchant_id AND r.merchant_b_id = _target_merchant_id)
      OR (r.merchant_b_id = _viewer_merchant_id AND r.merchant_a_id = _target_merchant_id))
  )
$$;

-- Tiered visibility
CREATE POLICY "Merchant profiles visibility by discoverability"
  ON public.merchant_profiles FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR discoverability = 'public'
    OR (discoverability IN ('merchant_id_only', 'hidden')
        AND public.has_relationship_with(public.current_merchant_id(), merchant_id))
  );

-- Admin bypass
CREATE POLICY "Admins can view all merchant profiles"
  ON public.merchant_profiles FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));