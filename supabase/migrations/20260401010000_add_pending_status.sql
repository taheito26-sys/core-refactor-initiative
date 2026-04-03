-- Add 'pending' to the status check for profit_share_agreements and set it as the new default.
ALTER TABLE public.profit_share_agreements DROP CONSTRAINT IF EXISTS profit_share_agreements_status_check;
ALTER TABLE public.profit_share_agreements ADD CONSTRAINT profit_share_agreements_status_check 
  CHECK (status IN ('pending', 'approved', 'rejected', 'expired'));

ALTER TABLE public.profit_share_agreements ALTER COLUMN status SET DEFAULT 'pending';

-- Refresh PostgREST cache again to recognize the new default and constraint.
NOTIFY pgrst, 'reload schema';
