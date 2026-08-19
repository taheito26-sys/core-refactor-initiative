-- No-op migration: touches the migrations directory to trigger the
-- Supabase deploy GitHub Action now that the migration-history repair
-- step is in place.
SELECT 1;
