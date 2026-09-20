-- fn_notify_loan_payment_claim (20260920150000) started stamping
-- target_tab = 'loans' on loan-payment-claim notifications so Accept/Apply
-- lands the merchant on Cash Management's Loans tab instead of the default
-- Accounts tab. chk_notifications_target_tab's allow-list didn't include
-- 'loans', so every one of those inserts -- the original claim, its
-- accept/reject, and any correction request -- failed with "new row for
-- relation notifications violates check constraint chk_notifications_target_tab",
-- which surfaced to the customer as "Could not send the request" on what
-- should have been a successful edit/delete submission.

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS chk_notifications_target_tab;
ALTER TABLE public.notifications
  ADD CONSTRAINT chk_notifications_target_tab
  CHECK (target_tab IS NULL OR target_tab IN (
    'my',
    'incoming',
    'outgoing',
    'transfers',
    'trades',
    'settlements',
    'clients',
    'agreements',
    'customer-orders',
    'loans'
  ));
