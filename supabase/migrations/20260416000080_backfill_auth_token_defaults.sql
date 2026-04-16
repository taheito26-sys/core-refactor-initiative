-- Normalize imported auth.users token columns for the Supabase OAuth flow.
-- The Lovable export left several token fields NULL, but the auth service path
-- in this project scans them as strings during sign-in / callback handling.

UPDATE auth.users
SET
  confirmation_token = COALESCE(confirmation_token, ''),
  recovery_token = COALESCE(recovery_token, ''),
  email_change_token_new = COALESCE(email_change_token_new, '');
