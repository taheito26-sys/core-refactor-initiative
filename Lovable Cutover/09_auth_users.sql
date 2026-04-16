-- ============================================================
-- Auth Users Export (auth.users + auth.identities)
-- Generated from Lovable Cloud database
-- ============================================================

-- WARNING: auth.users is a Supabase-managed table.
-- Direct INSERTs may not work on all Supabase projects.
-- Alternative: use supabase auth import or have users re-register.
-- These statements are provided as a reference / best-effort restore.

BEGIN;

INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, confirmed_at, last_sign_in_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) VALUES (
  '00000000-0000-0000-0000-000000000000',
  'd9acf3c1-c650-4c0c-8eba-13b992026ea0',
  'authenticated',
  'authenticated',
  'testmerchant@example.com',
  '',  -- passwords cannot be exported; users must reset
  '2026-03-22 06:52:08.866437+00',
  '2026-03-22 06:52:08.866437+00',
  '2026-03-22 06:52:38.760633+00',
  '{"provider": "email", "providers": ["email"]}'::jsonb,
  '{"email": "testmerchant@example.com", "email_verified": true, "phone_verified": false, "sub": "d9acf3c1-c650-4c0c-8eba-13b992026ea0"}'::jsonb,
  '2026-03-22 06:52:08.79536+00',
  now()
) ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, confirmed_at, last_sign_in_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) VALUES (
  '00000000-0000-0000-0000-000000000000',
  'c0c85f54-ad64-4baf-9247-6c81d131d9d9',
  'authenticated',
  'authenticated',
  'taheito26@gmail.com',
  '',  -- passwords cannot be exported; users must reset
  '2026-03-22 09:06:18.773408+00',
  '2026-03-22 09:06:18.773408+00',
  '2026-04-16 11:30:44.546451+00',
  '{"provider": "email", "providers": ["email", "google"]}'::jsonb,
  '{"avatar_url": "https://lh3.googleusercontent.com/a/ACg8ocIUpcHt-I7SCQgog20KuZTWSiRR5dY-pz6f2VJHX3ytKiBmQQ=s96-c", "email": "taheito26@gmail.com", "email_verified": true, "full_name": "Mohamed Taha", "iss": "https://accounts.google.com", "name": "Mohamed Taha", "phone_verified": false, "picture": "https://lh3.googleusercontent.com/a/ACg8ocIUpcHt-I7SCQgog20KuZTWSiRR5dY-pz6f2VJHX3ytKiBmQQ=s96-c", "provider_id": "108717341685489806343", "sub": "108717341685489806343"}'::jsonb,
  '2026-03-22 09:06:18.711871+00',
  now()
) ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, confirmed_at, last_sign_in_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) VALUES (
  '00000000-0000-0000-0000-000000000000',
  'efe7910b-3633-43f8-8423-5beefe1565b1',
  'authenticated',
  'authenticated',
  'muhamed.taha86@gmail.com',
  '',  -- passwords cannot be exported; users must reset
  '2026-03-22 17:14:51.500218+00',
  '2026-03-22 17:14:51.500218+00',
  '2026-04-15 08:59:04.065639+00',
  '{"provider": "email", "providers": ["email", "google"]}'::jsonb,
  '{"avatar_url": "https://lh3.googleusercontent.com/a/ACg8ocIppXqHEj9oIvD8LqZ0Vo2a_LwQT_QSa1oEXX87DrJXExmjskSO=s96-c", "email": "muhamed.taha86@gmail.com", "email_verified": true, "full_name": "Mohamed Taha", "iss": "https://accounts.google.com", "name": "Mohamed Taha", "phone_verified": false, "picture": "https://lh3.googleusercontent.com/a/ACg8ocIppXqHEj9oIvD8LqZ0Vo2a_LwQT_QSa1oEXX87DrJXExmjskSO=s96-c", "provider_id": "101373099141790976064", "sub": "101373099141790976064"}'::jsonb,
  '2026-03-22 17:14:51.453662+00',
  now()
) ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, confirmed_at, last_sign_in_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) VALUES (
  '00000000-0000-0000-0000-000000000000',
  '84fb9836-dd51-4cdf-b692-9d3de5c7c1df',
  'authenticated',
  'authenticated',
  'ahmednasser241093@gmail.com',
  '',  -- passwords cannot be exported; users must reset
  '2026-03-24 20:18:15.712533+00',
  '2026-03-24 20:18:15.712533+00',
  '2026-04-13 15:19:18.078565+00',
  '{"provider": "google", "providers": ["google"]}'::jsonb,
  '{"avatar_url": "https://lh3.googleusercontent.com/a/ACg8ocK2SNhNUt5yc5-EapoB5SEl9zyhEgU1-lWZmI5JmNT3Hfm3BOlY_g=s96-c", "email": "ahmednasser241093@gmail.com", "email_verified": true, "full_name": "Ahmed Nasser", "iss": "https://accounts.google.com", "name": "Ahmed Nasser", "phone_verified": false, "picture": "https://lh3.googleusercontent.com/a/ACg8ocK2SNhNUt5yc5-EapoB5SEl9zyhEgU1-lWZmI5JmNT3Hfm3BOlY_g=s96-c", "provider_id": "118423254601302697952", "sub": "118423254601302697952"}'::jsonb,
  '2026-03-24 20:18:15.659013+00',
  now()
) ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, confirmed_at, last_sign_in_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) VALUES (
  '00000000-0000-0000-0000-000000000000',
  'fc995e98-f667-4024-9d40-a9c75dab2320',
  'authenticated',
  'authenticated',
  'zakimlh83@gmail.com',
  '',  -- passwords cannot be exported; users must reset
  '2026-03-24 20:21:30.274914+00',
  '2026-03-24 20:21:30.274914+00',
  '2026-03-24 21:34:04.76058+00',
  '{"provider": "google", "providers": ["google"]}'::jsonb,
  '{"avatar_url": "https://lh3.googleusercontent.com/a/ACg8ocIYSxkQIFbJK5WlcrDm9ltz50G7lzUUCFv3urS1T994X1uCPt8a=s96-c", "email": "zakimlh83@gmail.com", "email_verified": true, "full_name": "Zack Zack", "iss": "https://accounts.google.com", "name": "Zack Zack", "phone_verified": false, "picture": "https://lh3.googleusercontent.com/a/ACg8ocIYSxkQIFbJK5WlcrDm9ltz50G7lzUUCFv3urS1T994X1uCPt8a=s96-c", "provider_id": "117670727181622177170", "sub": "117670727181622177170"}'::jsonb,
  '2026-03-24 20:21:30.21173+00',
  now()
) ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, confirmed_at, last_sign_in_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) VALUES (
  '00000000-0000-0000-0000-000000000000',
  '0e9a503a-502c-4ecf-8c63-449993fbad36',
  'authenticated',
  'authenticated',
  'qatar339090@gmail.com',
  '',  -- passwords cannot be exported; users must reset
  '2026-03-25 03:03:48.152323+00',
  '2026-03-25 03:03:48.152323+00',
  '2026-04-03 01:27:46.300974+00',
  '{"provider": "google", "providers": ["google"]}'::jsonb,
  '{"avatar_url": "https://lh3.googleusercontent.com/a/ACg8ocJbBYeTaeG46iWrk6_II50vMFNp1RcWn2Sj57H_F1MWvJTSRynf=s96-c", "email": "qatar339090@gmail.com", "email_verified": true, "full_name": "ahmed awny", "iss": "https://accounts.google.com", "name": "ahmed awny", "phone_verified": false, "picture": "https://lh3.googleusercontent.com/a/ACg8ocJbBYeTaeG46iWrk6_II50vMFNp1RcWn2Sj57H_F1MWvJTSRynf=s96-c", "provider_id": "100504263799576381787", "sub": "100504263799576381787"}'::jsonb,
  '2026-03-25 03:03:48.108813+00',
  now()
) ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, confirmed_at, last_sign_in_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) VALUES (
  '00000000-0000-0000-0000-000000000000',
  'f979a7ec-f60a-41c3-9eb9-bfa5a07ae823',
  'authenticated',
  'authenticated',
  'rogernadado@gmail.com',
  '',  -- passwords cannot be exported; users must reset
  '2026-03-28 17:55:23.594407+00',
  '2026-03-28 17:55:23.594407+00',
  '2026-04-09 18:36:41.004507+00',
  '{"provider": "google", "providers": ["google"]}'::jsonb,
  '{"avatar_url": "https://lh3.googleusercontent.com/a/ACg8ocJK1quYU_TAsk7f9cI2XH7WBba1IUhB-nf1n_TmuYpCQMYNsg=s96-c", "email": "rogernadado@gmail.com", "email_verified": true, "full_name": "Roger Nadado", "iss": "https://accounts.google.com", "name": "Roger Nadado", "phone_verified": false, "picture": "https://lh3.googleusercontent.com/a/ACg8ocJK1quYU_TAsk7f9cI2XH7WBba1IUhB-nf1n_TmuYpCQMYNsg=s96-c", "provider_id": "100679037225053741922", "sub": "100679037225053741922"}'::jsonb,
  '2026-03-28 17:55:23.527705+00',
  now()
) ON CONFLICT (id) DO NOTHING;

-- ── Auth Identities ──

INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, created_at, updated_at, last_sign_in_at) VALUES (
  '3daf486d-5c26-46d1-8a93-2bcc0b0eb79b',
  'd9acf3c1-c650-4c0c-8eba-13b992026ea0',
  '{"email": "testmerchant@example.com", "email_verified": false, "phone_verified": false, "sub": "d9acf3c1-c650-4c0c-8eba-13b992026ea0"}'::jsonb,
  'email',
  'd9acf3c1-c650-4c0c-8eba-13b992026ea0',
  '2026-03-22 06:52:08.860587+00',
  '2026-03-22 06:52:08.860587+00',
  '2026-03-22 06:52:08.860587+00'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, created_at, updated_at, last_sign_in_at) VALUES (
  'b4ed8001-ce62-4bbe-93de-5a2f540b1407',
  'c0c85f54-ad64-4baf-9247-6c81d131d9d9',
  '{"email": "taheito26@gmail.com", "email_verified": false, "phone_verified": false, "sub": "c0c85f54-ad64-4baf-9247-6c81d131d9d9"}'::jsonb,
  'email',
  'c0c85f54-ad64-4baf-9247-6c81d131d9d9',
  '2026-03-22 09:06:18.761159+00',
  '2026-03-22 09:06:18.761159+00',
  '2026-03-22 09:06:18.761159+00'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, created_at, updated_at, last_sign_in_at) VALUES (
  'd3a46483-45e8-49d2-a42f-3cd21bd56340',
  'efe7910b-3633-43f8-8423-5beefe1565b1',
  '{"email": "muhamed.taha86@gmail.com", "email_verified": false, "phone_verified": false, "sub": "efe7910b-3633-43f8-8423-5beefe1565b1"}'::jsonb,
  'email',
  'efe7910b-3633-43f8-8423-5beefe1565b1',
  '2026-03-22 17:14:51.494708+00',
  '2026-03-22 17:14:51.494708+00',
  '2026-03-22 17:14:51.494708+00'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, created_at, updated_at, last_sign_in_at) VALUES (
  'ec93f999-7d10-44bc-b17b-9bacb6167bdb',
  'c0c85f54-ad64-4baf-9247-6c81d131d9d9',
  '{"avatar_url": "https://lh3.googleusercontent.com/a/ACg8ocIUpcHt-I7SCQgog20KuZTWSiRR5dY-pz6f2VJHX3ytKiBmQQ=s96-c", "email": "taheito26@gmail.com", "email_verified": true, "full_name": "Mohamed Taha", "iss": "https://accounts.google.com", "name": "Mohamed Taha", "phone_verified": false, "picture": "https://lh3.googleusercontent.com/a/ACg8ocIUpcHt-I7SCQgog20KuZTWSiRR5dY-pz6f2VJHX3ytKiBmQQ=s96-c", "provider_id": "108717341685489806343", "sub": "108717341685489806343"}'::jsonb,
  'google',
  '108717341685489806343',
  '2026-03-24 10:35:30.530646+00',
  '2026-04-16 11:30:44.541987+00',
  '2026-03-24 10:35:30.530646+00'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, created_at, updated_at, last_sign_in_at) VALUES (
  'ffc49d4c-b9b6-4c78-8f7e-2423241f856c',
  'efe7910b-3633-43f8-8423-5beefe1565b1',
  '{"avatar_url": "https://lh3.googleusercontent.com/a/ACg8ocIppXqHEj9oIvD8LqZ0Vo2a_LwQT_QSa1oEXX87DrJXExmjskSO=s96-c", "email": "muhamed.taha86@gmail.com", "email_verified": true, "full_name": "Mohamed Taha", "iss": "https://accounts.google.com", "name": "Mohamed Taha", "phone_verified": false, "picture": "https://lh3.googleusercontent.com/a/ACg8ocIppXqHEj9oIvD8LqZ0Vo2a_LwQT_QSa1oEXX87DrJXExmjskSO=s96-c", "provider_id": "101373099141790976064", "sub": "101373099141790976064"}'::jsonb,
  'google',
  '101373099141790976064',
  '2026-03-24 10:43:56.88393+00',
  '2026-04-15 08:59:04.063712+00',
  '2026-03-24 10:43:56.88393+00'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, created_at, updated_at, last_sign_in_at) VALUES (
  '4469f550-f1f7-4d07-85a6-f8ee83dc39fa',
  '84fb9836-dd51-4cdf-b692-9d3de5c7c1df',
  '{"avatar_url": "https://lh3.googleusercontent.com/a/ACg8ocK2SNhNUt5yc5-EapoB5SEl9zyhEgU1-lWZmI5JmNT3Hfm3BOlY_g=s96-c", "email": "ahmednasser241093@gmail.com", "email_verified": true, "full_name": "Ahmed Nasser", "iss": "https://accounts.google.com", "name": "Ahmed Nasser", "phone_verified": false, "picture": "https://lh3.googleusercontent.com/a/ACg8ocK2SNhNUt5yc5-EapoB5SEl9zyhEgU1-lWZmI5JmNT3Hfm3BOlY_g=s96-c", "provider_id": "118423254601302697952", "sub": "118423254601302697952"}'::jsonb,
  'google',
  '118423254601302697952',
  '2026-03-24 20:18:15.700706+00',
  '2026-04-13 15:19:18.075197+00',
  '2026-03-24 20:18:15.700706+00'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, created_at, updated_at, last_sign_in_at) VALUES (
  '42e7269f-fd51-42aa-a1c0-f41d7eb4c927',
  'fc995e98-f667-4024-9d40-a9c75dab2320',
  '{"avatar_url": "https://lh3.googleusercontent.com/a/ACg8ocIYSxkQIFbJK5WlcrDm9ltz50G7lzUUCFv3urS1T994X1uCPt8a=s96-c", "email": "zakimlh83@gmail.com", "email_verified": true, "full_name": "Zack Zack", "iss": "https://accounts.google.com", "name": "Zack Zack", "phone_verified": false, "picture": "https://lh3.googleusercontent.com/a/ACg8ocIYSxkQIFbJK5WlcrDm9ltz50G7lzUUCFv3urS1T994X1uCPt8a=s96-c", "provider_id": "117670727181622177170", "sub": "117670727181622177170"}'::jsonb,
  'google',
  '117670727181622177170',
  '2026-03-24 20:21:30.267377+00',
  '2026-03-24 21:34:04.742436+00',
  '2026-03-24 20:21:30.267377+00'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, created_at, updated_at, last_sign_in_at) VALUES (
  'aea2feee-7315-422a-a0aa-40546e48dd11',
  '0e9a503a-502c-4ecf-8c63-449993fbad36',
  '{"avatar_url": "https://lh3.googleusercontent.com/a/ACg8ocJbBYeTaeG46iWrk6_II50vMFNp1RcWn2Sj57H_F1MWvJTSRynf=s96-c", "email": "qatar339090@gmail.com", "email_verified": true, "full_name": "ahmed awny", "iss": "https://accounts.google.com", "name": "ahmed awny", "phone_verified": false, "picture": "https://lh3.googleusercontent.com/a/ACg8ocJbBYeTaeG46iWrk6_II50vMFNp1RcWn2Sj57H_F1MWvJTSRynf=s96-c", "provider_id": "100504263799576381787", "sub": "100504263799576381787"}'::jsonb,
  'google',
  '100504263799576381787',
  '2026-03-25 03:03:48.140123+00',
  '2026-04-03 01:27:46.280541+00',
  '2026-03-25 03:03:48.140123+00'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, created_at, updated_at, last_sign_in_at) VALUES (
  'e69631ff-d3e6-4475-a617-ebd859497f8d',
  'f979a7ec-f60a-41c3-9eb9-bfa5a07ae823',
  '{"avatar_url": "https://lh3.googleusercontent.com/a/ACg8ocJK1quYU_TAsk7f9cI2XH7WBba1IUhB-nf1n_TmuYpCQMYNsg=s96-c", "email": "rogernadado@gmail.com", "email_verified": true, "full_name": "Roger Nadado", "iss": "https://accounts.google.com", "name": "Roger Nadado", "phone_verified": false, "picture": "https://lh3.googleusercontent.com/a/ACg8ocJK1quYU_TAsk7f9cI2XH7WBba1IUhB-nf1n_TmuYpCQMYNsg=s96-c", "provider_id": "100679037225053741922", "sub": "100679037225053741922"}'::jsonb,
  'google',
  '100679037225053741922',
  '2026-03-28 17:55:23.583274+00',
  '2026-04-09 18:36:41.000709+00',
  '2026-03-28 17:55:23.583274+00'
) ON CONFLICT (id) DO NOTHING;

COMMIT;