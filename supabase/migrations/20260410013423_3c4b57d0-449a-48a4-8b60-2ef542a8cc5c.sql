-- Reload PostgREST schema cache to clear any stale function signature metadata
NOTIFY pgrst, 'reload schema';