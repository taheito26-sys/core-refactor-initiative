-- Remembers which tracker Customer/Supplier a given exchange counterparty
-- name (a Binance/OKX P2P counterparty or Pay/network sender-receiver)
-- actually is, so repeat imports from the same real-world person resolve to
-- the same existing tracker entity instead of the user re-picking it every
-- time -- or, worse, a slightly different spelling silently creating a
-- near-duplicate customer/supplier.
--
-- entity_id is text, not uuid: Customer/Supplier ids are client-generated
-- short random strings (see uid() in src/lib/tracker-helpers.ts), not
-- database rows -- customers/suppliers live inside the TrackerState JSON
-- snapshot, not a normalized table, so there is nothing to foreign-key to.
-- Suppliers on the Stock page have no id concept at all (batches store a
-- plain source-name string), so entity_id is left null there and
-- entity_name alone is the canonical value that gets reused.

CREATE TABLE public.exchange_counterparty_map (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  exchange text NOT NULL CHECK (exchange IN ('binance', 'okx')),
  counterparty_name text NOT NULL,
  entity_type text NOT NULL CHECK (entity_type IN ('customer', 'supplier')),
  entity_id text,
  entity_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, exchange, counterparty_name, entity_type)
);
ALTER TABLE public.exchange_counterparty_map ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own counterparty map" ON public.exchange_counterparty_map
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_exchange_counterparty_map_user ON public.exchange_counterparty_map (user_id, exchange);
