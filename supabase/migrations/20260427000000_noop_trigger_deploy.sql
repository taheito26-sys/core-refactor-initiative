-- No-op migration: touches the migrations directory to trigger the
-- Supabase deploy GitHub Action (which runs `supabase db push` and
-- `supabase functions deploy`) so the pending exchange integration
-- migration and edge function get applied to the live project.
SELECT 1;
