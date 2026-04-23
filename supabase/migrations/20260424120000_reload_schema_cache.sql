-- Force PostgREST to reload its schema cache after recent migrations
-- This resolves 400 errors on RPCs caused by stale schema cache

NOTIFY pgrst, 'reload schema';
