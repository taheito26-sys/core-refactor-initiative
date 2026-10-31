-- OKX P2P sells are settled in EGP. Orders built from OKX escrow bills before the
-- fiat default changed were created as QAR with no price entered yet; only those
-- unpriced rows are switched, never an order the merchant has already priced.
UPDATE public.exchange_p2p_orders
SET fiat = 'EGP'
WHERE exchange = 'okx'
  AND raw ->> 'source' = 'okx-escrow'
  AND price = 0
  AND fiat = 'QAR';
