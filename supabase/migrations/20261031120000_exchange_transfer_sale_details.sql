-- OKX reports a P2P order's escrow as a bare USDT movement with no fiat price or
-- buyer, so the merchant records them on the row before importing it as a sale.
-- Existing RLS ("Users manage own exchange transfers") already covers updates, and
-- the sync upsert never writes these columns, so a re-sync keeps them.
ALTER TABLE public.exchange_transfers
  ADD COLUMN IF NOT EXISTS sale_price_qar numeric,
  ADD COLUMN IF NOT EXISTS sale_customer_name text;
