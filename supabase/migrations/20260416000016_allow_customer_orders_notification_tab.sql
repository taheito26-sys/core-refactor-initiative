-- Compatibility shim for order notifications from the export bundle.

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
    'customer-orders'
  ));
