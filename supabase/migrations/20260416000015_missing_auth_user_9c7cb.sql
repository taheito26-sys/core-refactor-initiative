-- Seed the one application user that was present in the Lovable data export
-- but missing from the auth export bundle. This keeps merchant/chat/profile
-- foreign keys intact during the data import.

INSERT INTO auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  last_sign_in_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
) VALUES (
  '00000000-0000-0000-0000-000000000000',
  '9c7cb167-e635-4e09-b9c0-b1fd07134e88',
  'authenticated',
  'authenticated',
  'tamerelmaghloub@gmail.com',
  '',
  '2026-04-14 03:28:19.777+00',
  '2026-04-14 03:28:19.777+00',
  '{"provider": "email", "providers": ["email"]}'::jsonb,
  '{"email": "tamerelmaghloub@gmail.com", "email_verified": true, "phone_verified": false, "sub": "9c7cb167-e635-4e09-b9c0-b1fd07134e88"}'::jsonb,
  '2026-04-14 03:26:39.042176+00',
  now()
) ON CONFLICT (id) DO NOTHING;

