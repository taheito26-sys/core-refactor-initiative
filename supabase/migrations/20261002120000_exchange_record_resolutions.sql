-- Lets a merchant resolve any Binance / OKX record that is not in the
-- tracker without registering it: ignore it, remove it, or fix the stock by
-- hand. P2P orders gain the same dismissed_at transfers already had, and
-- both tables record why and an optional note, so a resolved record can be
-- listed and restored later instead of vanishing.
ALTER TABLE public.exchange_p2p_orders ADD COLUMN IF NOT EXISTS dismissed_at timestamptz;
ALTER TABLE public.exchange_p2p_orders ADD COLUMN IF NOT EXISTS dismiss_reason text;
ALTER TABLE public.exchange_p2p_orders ADD COLUMN IF NOT EXISTS dismiss_note text;
ALTER TABLE public.exchange_transfers ADD COLUMN IF NOT EXISTS dismiss_reason text;
ALTER TABLE public.exchange_transfers ADD COLUMN IF NOT EXISTS dismiss_note text;

ALTER TABLE public.exchange_p2p_orders DROP CONSTRAINT IF EXISTS exchange_p2p_orders_dismiss_reason_check;
ALTER TABLE public.exchange_p2p_orders ADD CONSTRAINT exchange_p2p_orders_dismiss_reason_check
  CHECK (dismiss_reason IS NULL OR dismiss_reason IN ('ignored', 'deleted', 'adjusted'));
ALTER TABLE public.exchange_transfers DROP CONSTRAINT IF EXISTS exchange_transfers_dismiss_reason_check;
ALTER TABLE public.exchange_transfers ADD CONSTRAINT exchange_transfers_dismiss_reason_check
  CHECK (dismiss_reason IS NULL OR dismiss_reason IN ('ignored', 'deleted', 'adjusted'));
