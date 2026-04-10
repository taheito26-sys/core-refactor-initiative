
-- =============================================
-- OTC LISTINGS — merchants post cash/USDT availability
-- =============================================
CREATE TABLE public.otc_listings (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  merchant_id text NOT NULL,
  side text NOT NULL CHECK (side IN ('cash', 'usdt')),
  currency text NOT NULL DEFAULT 'QAR',
  amount_min numeric NOT NULL DEFAULT 0,
  amount_max numeric NOT NULL DEFAULT 0,
  rate numeric NOT NULL DEFAULT 0,
  payment_methods text[] NOT NULL DEFAULT '{}',
  note text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'expired')),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_otc_listings_status ON public.otc_listings (status);
CREATE INDEX idx_otc_listings_side ON public.otc_listings (side);
CREATE INDEX idx_otc_listings_user ON public.otc_listings (user_id);

-- RLS
ALTER TABLE public.otc_listings ENABLE ROW LEVEL SECURITY;

-- All authenticated users can browse active listings
CREATE POLICY "otc_listings_select" ON public.otc_listings
  FOR SELECT TO authenticated
  USING (true);

-- Owner can insert
CREATE POLICY "otc_listings_insert" ON public.otc_listings
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Owner can update
CREATE POLICY "otc_listings_update" ON public.otc_listings
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Owner can delete
CREATE POLICY "otc_listings_delete" ON public.otc_listings
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- =============================================
-- OTC TRADES — negotiation: offer → counter → confirm → complete
-- =============================================
CREATE TABLE public.otc_trades (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  listing_id uuid REFERENCES public.otc_listings(id) ON DELETE SET NULL,
  initiator_user_id uuid NOT NULL,
  responder_user_id uuid NOT NULL,
  initiator_merchant_id text NOT NULL,
  responder_merchant_id text NOT NULL,
  side text NOT NULL CHECK (side IN ('cash', 'usdt')),
  currency text NOT NULL DEFAULT 'QAR',
  amount numeric NOT NULL DEFAULT 0,
  rate numeric NOT NULL DEFAULT 0,
  total numeric NOT NULL DEFAULT 0,
  counter_amount numeric,
  counter_rate numeric,
  counter_total numeric,
  note text,
  counter_note text,
  status text NOT NULL DEFAULT 'offered' CHECK (status IN ('offered', 'countered', 'confirmed', 'completed', 'cancelled', 'expired')),
  chat_room_id uuid REFERENCES public.chat_rooms(id) ON DELETE SET NULL,
  confirmed_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_otc_trades_status ON public.otc_trades (status);
CREATE INDEX idx_otc_trades_initiator ON public.otc_trades (initiator_user_id);
CREATE INDEX idx_otc_trades_responder ON public.otc_trades (responder_user_id);
CREATE INDEX idx_otc_trades_listing ON public.otc_trades (listing_id);

-- RLS
ALTER TABLE public.otc_trades ENABLE ROW LEVEL SECURITY;

-- Participants can view their trades
CREATE POLICY "otc_trades_select" ON public.otc_trades
  FOR SELECT TO authenticated
  USING (initiator_user_id = auth.uid() OR responder_user_id = auth.uid());

-- Anyone authenticated can create a trade (send offer)
CREATE POLICY "otc_trades_insert" ON public.otc_trades
  FOR INSERT TO authenticated
  WITH CHECK (initiator_user_id = auth.uid());

-- Participants can update their trades
CREATE POLICY "otc_trades_update" ON public.otc_trades
  FOR UPDATE TO authenticated
  USING (initiator_user_id = auth.uid() OR responder_user_id = auth.uid());

-- Participants can delete (cancel)
CREATE POLICY "otc_trades_delete" ON public.otc_trades
  FOR DELETE TO authenticated
  USING (initiator_user_id = auth.uid() OR responder_user_id = auth.uid());

-- =============================================
-- Timestamps trigger
-- =============================================
CREATE OR REPLACE FUNCTION public.update_otc_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER trg_otc_listings_updated_at
  BEFORE UPDATE ON public.otc_listings
  FOR EACH ROW EXECUTE FUNCTION public.update_otc_updated_at();

CREATE TRIGGER trg_otc_trades_updated_at
  BEFORE UPDATE ON public.otc_trades
  FOR EACH ROW EXECUTE FUNCTION public.update_otc_updated_at();

-- Enable realtime for trades (live status updates)
ALTER PUBLICATION supabase_realtime ADD TABLE public.otc_listings;
ALTER PUBLICATION supabase_realtime ADD TABLE public.otc_trades;
