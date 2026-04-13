
-- ============================================================
-- Taheito P2P Platform — Full Database Schema
-- ============================================================

-- 1. Timestamp trigger function (reusable)
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- 2. Role enum and user_roles table
CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL,
  UNIQUE (user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Security definer function for role checks (avoids RLS recursion)
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

CREATE POLICY "Users can view own roles"
  ON public.user_roles FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all roles"
  ON public.user_roles FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can manage roles"
  ON public.user_roles FOR ALL
  USING (public.has_role(auth.uid(), 'admin'));

-- 3. Profiles table (extends auth.users)
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'suspended')),
  approved_by UUID REFERENCES auth.users(id),
  approved_at TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all profiles"
  ON public.profiles FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can update all profiles"
  ON public.profiles FOR UPDATE
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4. Merchant profiles
CREATE TABLE public.merchant_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  merchant_id TEXT NOT NULL UNIQUE,
  nickname TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  bio TEXT,
  region TEXT,
  default_currency TEXT NOT NULL DEFAULT 'USDT',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.merchant_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Merchant profiles are viewable by authenticated users"
  ON public.merchant_profiles FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Users can insert own merchant profile"
  ON public.merchant_profiles FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own merchant profile"
  ON public.merchant_profiles FOR UPDATE
  USING (auth.uid() = user_id);

CREATE TRIGGER update_merchant_profiles_updated_at
  BEFORE UPDATE ON public.merchant_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 5. Merchant relationships
CREATE TABLE public.merchant_relationships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_a_id TEXT NOT NULL REFERENCES public.merchant_profiles(merchant_id),
  merchant_b_id TEXT NOT NULL REFERENCES public.merchant_profiles(merchant_id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'ended')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (merchant_a_id <> merchant_b_id)
);
ALTER TABLE public.merchant_relationships ENABLE ROW LEVEL SECURITY;

-- Helper function to get merchant_id for current user
CREATE OR REPLACE FUNCTION public.current_merchant_id()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT merchant_id FROM public.merchant_profiles WHERE user_id = auth.uid()
$$;

CREATE POLICY "Users can view own relationships"
  ON public.merchant_relationships FOR SELECT
  USING (current_merchant_id() IN (merchant_a_id, merchant_b_id));

CREATE POLICY "Users can insert relationships they are part of"
  ON public.merchant_relationships FOR INSERT
  WITH CHECK (current_merchant_id() IN (merchant_a_id, merchant_b_id));

CREATE POLICY "Users can update own relationships"
  ON public.merchant_relationships FOR UPDATE
  USING (current_merchant_id() IN (merchant_a_id, merchant_b_id));

CREATE TRIGGER update_merchant_relationships_updated_at
  BEFORE UPDATE ON public.merchant_relationships
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 6. Merchant invites
CREATE TABLE public.merchant_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_merchant_id TEXT NOT NULL REFERENCES public.merchant_profiles(merchant_id),
  to_merchant_id TEXT NOT NULL REFERENCES public.merchant_profiles(merchant_id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  message TEXT,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '7 days'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (from_merchant_id <> to_merchant_id)
);
ALTER TABLE public.merchant_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view invites they sent or received"
  ON public.merchant_invites FOR SELECT
  USING (current_merchant_id() IN (from_merchant_id, to_merchant_id));

CREATE POLICY "Users can send invites"
  ON public.merchant_invites FOR INSERT
  WITH CHECK (current_merchant_id() = from_merchant_id);

CREATE POLICY "Recipients can update invites"
  ON public.merchant_invites FOR UPDATE
  USING (current_merchant_id() = to_merchant_id);

-- 7. Merchant deals
CREATE TABLE public.merchant_deals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  relationship_id UUID NOT NULL REFERENCES public.merchant_relationships(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  amount DECIMAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USDT',
  deal_type TEXT NOT NULL DEFAULT 'general' CHECK (deal_type IN ('loan', 'investment', 'general')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved')),
  created_by UUID NOT NULL REFERENCES auth.users(id),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.merchant_deals ENABLE ROW LEVEL SECURITY;

-- Helper: check if user is part of a relationship
CREATE OR REPLACE FUNCTION public.is_relationship_member(_relationship_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.merchant_relationships r
    WHERE r.id = _relationship_id
    AND current_merchant_id() IN (r.merchant_a_id, r.merchant_b_id)
  )
$$;

CREATE POLICY "Relationship members can view deals"
  ON public.merchant_deals FOR SELECT
  USING (public.is_relationship_member(relationship_id));

CREATE POLICY "Relationship members can create deals"
  ON public.merchant_deals FOR INSERT
  WITH CHECK (auth.uid() = created_by AND public.is_relationship_member(relationship_id));

CREATE POLICY "Relationship members can update deals"
  ON public.merchant_deals FOR UPDATE
  USING (public.is_relationship_member(relationship_id));

CREATE POLICY "Deal creators can delete own pending deals"
  ON public.merchant_deals FOR DELETE
  USING (auth.uid() = created_by AND status = 'pending');

CREATE TRIGGER update_merchant_deals_updated_at
  BEFORE UPDATE ON public.merchant_deals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 8. Merchant approvals
CREATE TABLE public.merchant_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  relationship_id UUID NOT NULL REFERENCES public.merchant_relationships(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('deal_creation', 'deal_update')),
  target_entity_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  submitted_by UUID NOT NULL REFERENCES auth.users(id),
  reviewer_id UUID REFERENCES auth.users(id),
  resolution_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.merchant_approvals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Relationship members can view approvals"
  ON public.merchant_approvals FOR SELECT
  USING (public.is_relationship_member(relationship_id));

CREATE POLICY "Relationship members can create approvals"
  ON public.merchant_approvals FOR INSERT
  WITH CHECK (auth.uid() = submitted_by AND public.is_relationship_member(relationship_id));

CREATE POLICY "Relationship members can update approvals"
  ON public.merchant_approvals FOR UPDATE
  USING (public.is_relationship_member(relationship_id));

CREATE TRIGGER update_merchant_approvals_updated_at
  BEFORE UPDATE ON public.merchant_approvals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 9. Merchant messages
CREATE TABLE public.merchant_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  relationship_id UUID NOT NULL REFERENCES public.merchant_relationships(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES auth.users(id),
  content TEXT NOT NULL,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.merchant_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Relationship members can view messages"
  ON public.merchant_messages FOR SELECT
  USING (public.is_relationship_member(relationship_id));

CREATE POLICY "Relationship members can send messages"
  ON public.merchant_messages FOR INSERT
  WITH CHECK (auth.uid() = sender_id AND public.is_relationship_member(relationship_id));

CREATE POLICY "Message recipients can mark as read"
  ON public.merchant_messages FOR UPDATE
  USING (public.is_relationship_member(relationship_id));

-- 10. Merchant settlements
CREATE TABLE public.merchant_settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES public.merchant_deals(id) ON DELETE CASCADE,
  amount DECIMAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USDT',
  settled_by UUID NOT NULL REFERENCES auth.users(id),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.merchant_settlements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view settlements for their deals"
  ON public.merchant_settlements FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.merchant_deals d
      WHERE d.id = deal_id
      AND public.is_relationship_member(d.relationship_id)
    )
  );

CREATE POLICY "Users can create settlements for their deals"
  ON public.merchant_settlements FOR INSERT
  WITH CHECK (
    auth.uid() = settled_by
    AND EXISTS (
      SELECT 1 FROM public.merchant_deals d
      WHERE d.id = deal_id
      AND public.is_relationship_member(d.relationship_id)
    )
  );

-- 11. Merchant profits
CREATE TABLE public.merchant_profits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES public.merchant_deals(id) ON DELETE CASCADE,
  amount DECIMAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USDT',
  recorded_by UUID NOT NULL REFERENCES auth.users(id),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.merchant_profits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view profits for their deals"
  ON public.merchant_profits FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.merchant_deals d
      WHERE d.id = deal_id
      AND public.is_relationship_member(d.relationship_id)
    )
  );

CREATE POLICY "Users can record profits for their deals"
  ON public.merchant_profits FOR INSERT
  WITH CHECK (
    auth.uid() = recorded_by
    AND EXISTS (
      SELECT 1 FROM public.merchant_deals d
      WHERE d.id = deal_id
      AND public.is_relationship_member(d.relationship_id)
    )
  );

-- 12. Notifications
CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category TEXT NOT NULL DEFAULT 'system' CHECK (category IN ('invite', 'approval', 'system', 'message', 'deal')),
  title TEXT NOT NULL,
  body TEXT,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own notifications"
  ON public.notifications FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own notifications"
  ON public.notifications FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "System can create notifications"
  ON public.notifications FOR INSERT
  WITH CHECK (true);

-- 13. Admin audit logs
CREATE TABLE public.admin_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id UUID NOT NULL REFERENCES auth.users(id),
  action TEXT NOT NULL,
  target_type TEXT NOT NULL DEFAULT 'user',
  target_id UUID,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view audit logs"
  ON public.admin_audit_logs FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can create audit logs"
  ON public.admin_audit_logs FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 14. P2P rate snapshots (replaces KV cache)
CREATE TABLE public.p2p_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market TEXT NOT NULL,
  data JSONB NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.p2p_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can read P2P snapshots"
  ON public.p2p_snapshots FOR SELECT
  TO authenticated USING (true);

-- Index for fast latest-snapshot lookups
CREATE INDEX idx_p2p_snapshots_market_time ON public.p2p_snapshots (market, fetched_at DESC);

-- 15. Indexes for performance
CREATE INDEX idx_profiles_user_id ON public.profiles (user_id);
CREATE INDEX idx_profiles_status ON public.profiles (status);
CREATE INDEX idx_merchant_profiles_user_id ON public.merchant_profiles (user_id);
CREATE INDEX idx_merchant_profiles_merchant_id ON public.merchant_profiles (merchant_id);
CREATE INDEX idx_merchant_relationships_a ON public.merchant_relationships (merchant_a_id);
CREATE INDEX idx_merchant_relationships_b ON public.merchant_relationships (merchant_b_id);
CREATE INDEX idx_merchant_invites_from ON public.merchant_invites (from_merchant_id);
CREATE INDEX idx_merchant_invites_to ON public.merchant_invites (to_merchant_id);
CREATE INDEX idx_merchant_deals_relationship ON public.merchant_deals (relationship_id);
CREATE INDEX idx_merchant_approvals_relationship ON public.merchant_approvals (relationship_id);
CREATE INDEX idx_merchant_messages_relationship ON public.merchant_messages (relationship_id);
CREATE INDEX idx_notifications_user_id ON public.notifications (user_id, read_at);
CREATE INDEX idx_admin_audit_logs_admin ON public.admin_audit_logs (admin_user_id);

-- 16. Enable realtime for notifications and messages
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
ALTER PUBLICATION supabase_realtime ADD TABLE public.merchant_messages;
