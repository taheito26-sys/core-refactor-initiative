-- Exchange integrations: connect Binance/OKX accounts to pull spot & funding
-- balances and P2P order history, and link imported P2P orders into the
-- tracker (stock batches / sell trades).

CREATE TABLE public.exchange_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  exchange text NOT NULL CHECK (exchange IN ('binance', 'okx')),
  label text,
  api_key text NOT NULL,
  api_secret text NOT NULL,
  passphrase text, -- OKX only
  last_synced_at timestamptz,
  last_sync_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, exchange)
);
ALTER TABLE public.exchange_credentials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own exchange credentials" ON public.exchange_credentials
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_exchange_credentials_updated_at BEFORE UPDATE ON public.exchange_credentials
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.exchange_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  exchange text NOT NULL CHECK (exchange IN ('binance', 'okx')),
  account_type text NOT NULL CHECK (account_type IN ('spot', 'funding')),
  asset text NOT NULL,
  free numeric NOT NULL DEFAULT 0,
  locked numeric NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, exchange, account_type, asset)
);
ALTER TABLE public.exchange_balances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own exchange balances" ON public.exchange_balances
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Service role writes exchange balances" ON public.exchange_balances
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.exchange_p2p_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  exchange text NOT NULL CHECK (exchange IN ('binance', 'okx')),
  order_number text NOT NULL,
  side text NOT NULL CHECK (side IN ('buy', 'sell')),
  asset text NOT NULL,
  fiat text NOT NULL,
  amount numeric NOT NULL,
  price numeric NOT NULL,
  total numeric NOT NULL,
  status text NOT NULL,
  counterparty text,
  order_time timestamptz,
  raw jsonb,
  -- Linking into the local-first tracker (batches/trades live client-side,
  -- so we only keep a soft reference: the tracker entity id + type once the
  -- user confirms the import).
  linked_entity_type text CHECK (linked_entity_type IN ('batch', 'trade')),
  linked_entity_id text,
  linked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, exchange, order_number)
);
ALTER TABLE public.exchange_p2p_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own exchange p2p orders" ON public.exchange_p2p_orders
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_exchange_p2p_orders_user ON public.exchange_p2p_orders (user_id, order_time DESC);
CREATE INDEX idx_exchange_balances_user ON public.exchange_balances (user_id);
