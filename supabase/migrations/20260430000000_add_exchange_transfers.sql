-- Exchange transfers: USDT moving in/out of a connected exchange account by
-- means other than a P2P order -- Binance Pay / OKX internal transfers, and
-- on-chain (network) deposits & withdrawals.
--
-- These matter to the tracker because incoming USDT is inventory arriving:
-- unlike a P2P buy, a Pay/network transfer carries no fiat price, so the cost
-- basis has to be supplied by the user at import time.

CREATE TABLE public.exchange_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  exchange text NOT NULL CHECK (exchange IN ('binance', 'okx')),
  -- 'pay'     = Binance Pay / OKX internal account-to-account transfer
  -- 'network' = on-chain deposit or withdrawal
  kind text NOT NULL CHECK (kind IN ('pay', 'network')),
  direction text NOT NULL CHECK (direction IN ('in', 'out')),
  asset text NOT NULL,
  amount numeric NOT NULL,
  status text NOT NULL,
  -- Exchange-side identifier: Pay transaction id, or on-chain tx hash.
  reference text NOT NULL,
  counterparty text,
  network text,
  transfer_time timestamptz,
  raw jsonb,
  -- Soft link into the local-first tracker, same pattern as exchange_p2p_orders.
  linked_entity_type text CHECK (linked_entity_type IN ('batch', 'trade')),
  linked_entity_id text,
  linked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, exchange, kind, direction, reference)
);
ALTER TABLE public.exchange_transfers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own exchange transfers" ON public.exchange_transfers
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_exchange_transfers_user ON public.exchange_transfers (user_id, transfer_time DESC);
