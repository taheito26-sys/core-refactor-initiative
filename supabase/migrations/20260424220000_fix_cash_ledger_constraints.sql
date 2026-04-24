-- Fix cash_ledger constraints to support customer order receipt flow.
-- Current constraints are too restrictive for the new customer portal features.

-- currency: add EGP
ALTER TABLE public.cash_ledger DROP CONSTRAINT IF EXISTS cash_ledger_currency_check;
ALTER TABLE public.cash_ledger ADD CONSTRAINT cash_ledger_currency_check
  CHECK (currency = ANY (ARRAY['QAR'::text, 'EGP'::text, 'USDT'::text, 'USD'::text, 'AED'::text, 'SAR'::text]));

-- type: add order_receipt
ALTER TABLE public.cash_ledger DROP CONSTRAINT IF EXISTS cash_ledger_type_check;
ALTER TABLE public.cash_ledger ADD CONSTRAINT cash_ledger_type_check
  CHECK (type = ANY (ARRAY[
    'opening'::text, 'deposit'::text, 'withdrawal'::text,
    'transfer_in'::text, 'transfer_out'::text,
    'stock_purchase'::text, 'stock_refund'::text, 'stock_edit_adjust'::text,
    'reconcile'::text, 'order_receipt'::text
  ]));

-- linked_entity_type: add customer_order
ALTER TABLE public.cash_ledger DROP CONSTRAINT IF EXISTS cash_ledger_linked_entity_type_check;
ALTER TABLE public.cash_ledger ADD CONSTRAINT cash_ledger_linked_entity_type_check
  CHECK (linked_entity_type = ANY (ARRAY['batch'::text, 'trade'::text, 'customer_order'::text]));

NOTIFY pgrst, 'reload schema';
