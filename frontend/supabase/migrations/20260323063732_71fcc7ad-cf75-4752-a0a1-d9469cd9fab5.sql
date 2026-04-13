-- Fix search_path warnings on validation trigger functions
ALTER FUNCTION public.validate_discoverability() SET search_path = public;
ALTER FUNCTION public.validate_settlement_status() SET search_path = public;
ALTER FUNCTION public.validate_profit_status() SET search_path = public;