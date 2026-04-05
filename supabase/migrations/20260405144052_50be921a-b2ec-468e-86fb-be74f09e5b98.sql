
CREATE TABLE IF NOT EXISTS public.settlement_overviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  relationship_id uuid NOT NULL,
  agreement_id uuid,
  period_label text,
  total_profit numeric NOT NULL DEFAULT 0,
  total_reinvested numeric NOT NULL DEFAULT 0,
  total_withdrawn numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.settlement_overviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "so_select" ON public.settlement_overviews FOR SELECT USING (public.is_relationship_member(relationship_id));
CREATE POLICY "so_insert" ON public.settlement_overviews FOR INSERT WITH CHECK (public.is_relationship_member(relationship_id));
CREATE POLICY "so_update" ON public.settlement_overviews FOR UPDATE USING (public.is_relationship_member(relationship_id));

CREATE TABLE IF NOT EXISTS public.profit_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  relationship_id uuid NOT NULL,
  deal_id uuid,
  agreement_id uuid,
  period_id uuid,
  merchant_id text NOT NULL,
  amount numeric NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'USDT',
  type text NOT NULL DEFAULT 'profit',
  status text NOT NULL DEFAULT 'pending',
  notes text,
  recorded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.profit_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pr_select" ON public.profit_records FOR SELECT USING (public.is_relationship_member(relationship_id));
CREATE POLICY "pr_insert" ON public.profit_records FOR INSERT WITH CHECK (public.is_relationship_member(relationship_id));

CREATE TABLE IF NOT EXISTS public.balance_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  relationship_id uuid NOT NULL,
  merchant_id text NOT NULL,
  amount numeric NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'USDT',
  type text NOT NULL DEFAULT 'credit',
  reference_id text,
  reference_type text,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.balance_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bl_select" ON public.balance_ledger FOR SELECT USING (public.is_relationship_member(relationship_id));
CREATE POLICY "bl_insert" ON public.balance_ledger FOR INSERT WITH CHECK (public.is_relationship_member(relationship_id));

CREATE TABLE IF NOT EXISTS public.deal_capital (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL,
  relationship_id uuid NOT NULL,
  merchant_id text NOT NULL,
  amount numeric NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'USDT',
  type text NOT NULL DEFAULT 'contribution',
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.deal_capital ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dc_select" ON public.deal_capital FOR SELECT USING (public.is_relationship_member(relationship_id));
CREATE POLICY "dc_insert" ON public.deal_capital FOR INSERT WITH CHECK (public.is_relationship_member(relationship_id));

CREATE TABLE IF NOT EXISTS public.tracker_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  state jsonb NOT NULL DEFAULT '{}'::jsonb,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.tracker_states ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ts_all" ON public.tracker_states FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.gas_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  action text NOT NULL,
  gas_used numeric NOT NULL DEFAULT 0,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.gas_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "gl_all" ON public.gas_log FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
