
-- ── cash_accounts ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cash_accounts (
  id            TEXT        PRIMARY KEY,
  user_id       UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name          TEXT        NOT NULL,
  type          TEXT        NOT NULL CHECK (type IN ('hand', 'bank', 'vault')),
  currency      TEXT        NOT NULL CHECK (currency IN ('QAR', 'USDT', 'USD')),
  status        TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  bank_name     TEXT,
  branch        TEXT,
  notes         TEXT,
  last_reconciled BIGINT,
  created_at    BIGINT      NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.cash_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own cash accounts"
  ON public.cash_accounts FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_cash_accounts_user_id ON public.cash_accounts(user_id);

-- ── cash_ledger ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cash_ledger (
  id                  TEXT        PRIMARY KEY,
  user_id             UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id          TEXT        NOT NULL REFERENCES public.cash_accounts(id) ON DELETE CASCADE,
  contra_account_id   TEXT        REFERENCES public.cash_accounts(id) ON DELETE SET NULL,
  ts                  BIGINT      NOT NULL,
  type                TEXT        NOT NULL CHECK (type IN (
                        'opening','deposit','withdrawal',
                        'transfer_in','transfer_out',
                        'stock_purchase','stock_refund','stock_edit_adjust','reconcile'
                      )),
  direction           TEXT        NOT NULL CHECK (direction IN ('in','out')),
  amount              NUMERIC(18,6) NOT NULL DEFAULT 0,
  currency            TEXT        NOT NULL CHECK (currency IN ('QAR','USDT','USD')),
  note                TEXT,
  linked_entity_id    TEXT,
  linked_entity_type  TEXT        CHECK (linked_entity_type IN ('batch','trade')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.cash_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own cash ledger"
  ON public.cash_ledger FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_cash_ledger_user_id  ON public.cash_ledger(user_id);
CREATE INDEX idx_cash_ledger_account  ON public.cash_ledger(account_id);
CREATE INDEX idx_cash_ledger_ts       ON public.cash_ledger(ts DESC);
CREATE INDEX idx_cash_ledger_type     ON public.cash_ledger(type);
