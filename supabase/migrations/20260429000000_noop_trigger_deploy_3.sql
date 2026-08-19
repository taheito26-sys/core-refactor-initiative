-- No-op migration: touches the migrations directory to trigger the
-- Supabase deploy GitHub Action now that exchange_credentials'
-- migration history is also repaired.
SELECT 1;
