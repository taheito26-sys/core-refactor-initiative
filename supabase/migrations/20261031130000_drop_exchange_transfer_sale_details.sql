-- OKX P2P escrows are now P2P orders (price and buyer live on exchange_p2p_orders),
-- so the transfer-level columns added in 20261031120000 were never written.
ALTER TABLE public.exchange_transfers
  DROP COLUMN IF EXISTS sale_price_qar,
  DROP COLUMN IF EXISTS sale_customer_name;
