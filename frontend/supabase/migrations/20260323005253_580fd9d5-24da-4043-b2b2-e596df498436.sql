
-- Add merchant_code column (unique 4-digit code)
ALTER TABLE public.merchant_profiles ADD COLUMN merchant_code text UNIQUE;

-- Set merchant_code = '8624' for taheito26@gmail.com
UPDATE public.merchant_profiles
SET merchant_code = '8624'
WHERE user_id = (
  SELECT id FROM auth.users WHERE email = 'taheito26@gmail.com'
);
