-- Lets a merchant mark a Binance Pay / on-chain transfer as "not an order"
-- (e.g. a loan repayment received via Pay, not a sale) so it stops showing
-- in the exchange inbox without being imported as a batch/trade.
ALTER TABLE public.exchange_transfers ADD COLUMN dismissed_at timestamptz;
