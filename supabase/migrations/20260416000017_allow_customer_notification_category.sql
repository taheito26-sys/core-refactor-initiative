-- Compatibility shim for imported customer connection notifications.
-- The live export uses category = 'customer', but the current schema check
-- only allows the newer notification taxonomy.

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_category_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_category_check
  CHECK (category = ANY (ARRAY[
    'invite',
    'approval',
    'system',
    'message',
    'deal',
    'stock',
    'customer_order',
    'customer_message',
    'order',
    'agreement',
    'settlement',
    'chat',
    'customer'
  ]));
