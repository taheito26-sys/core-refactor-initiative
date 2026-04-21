-- Force PostgREST to reload its schema cache so mirror_merchant_customer_order
-- resolves correctly after the 20260420160000 migration replaced the function.
NOTIFY pgrst, 'reload schema';
