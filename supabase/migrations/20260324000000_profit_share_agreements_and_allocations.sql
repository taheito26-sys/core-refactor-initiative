-- ═══════════════════════════════════════════════════════════════════════
-- Migration: Standing Profit Share Agreements + Order Allocations
-- ═══════════════════════════════════════════════════════════════════════
-- This migration introduces:
-- 1. profit_share_agreements: Standing bilateral agreements for profit sharing
-- 2. order_allocations: Per-merchant, per-order allocation records
-- Existing tables (merchant_deals, etc.) are NOT modified for legacy compat.

-- ─── Profit Share Agreements ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS profit_share_agreements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  relationship_id UUID NOT NULL REFERENCES merchant_relationships(id) ON DELETE CASCADE,
  partner_ratio NUMERIC(5,2) NOT NULL CHECK (partner_ratio > 0 AND partner_ratio < 100),
  merchant_ratio NUMERIC(5,2) NOT NULL CHECK (merchant_ratio > 0 AND merchant_ratio < 100),
  settlement_cadence TEXT NOT NULL DEFAULT 'monthly' CHECK (settlement_cadence IN ('monthly', 'weekly', 'per_order')),
  status TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('approved', 'rejected', 'expired')),
  effective_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  created_by UUID NOT NULL,
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT valid_ratios CHECK (partner_ratio + merchant_ratio = 100)
);

-- Indexes for profit_share_agreements
CREATE INDEX idx_psa_relationship ON profit_share_agreements(relationship_id);
CREATE INDEX idx_psa_status ON profit_share_agreements(status);
CREATE INDEX idx_psa_created_by ON profit_share_agreements(created_by);
CREATE INDEX idx_psa_effective ON profit_share_agreements(effective_from, expires_at);

-- ─── Order Allocations ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS order_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_group_id UUID NOT NULL,
  order_id TEXT NOT NULL,
  relationship_id UUID NOT NULL REFERENCES merchant_relationships(id) ON DELETE CASCADE,
  merchant_id TEXT NOT NULL,
  family TEXT NOT NULL CHECK (family IN ('profit_share', 'sales_deal', 'capital_transfer')),
  profit_share_agreement_id UUID REFERENCES profit_share_agreements(id),
  -- Allocation economics
  allocated_usdt NUMERIC(18,6) NOT NULL DEFAULT 0,
  merchant_cost_per_usdt NUMERIC(18,6) NOT NULL DEFAULT 0,
  sell_price NUMERIC(18,6) NOT NULL DEFAULT 0,
  fee_share NUMERIC(18,6) NOT NULL DEFAULT 0,
  -- Calculated fields
  allocation_revenue NUMERIC(18,6) NOT NULL DEFAULT 0,
  allocation_cost NUMERIC(18,6) NOT NULL DEFAULT 0,
  allocation_fee NUMERIC(18,6) NOT NULL DEFAULT 0,
  allocation_net NUMERIC(18,6) NOT NULL DEFAULT 0,
  -- Split details (snapshot)
  partner_share_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
  merchant_share_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
  partner_amount NUMERIC(18,6) NOT NULL DEFAULT 0,
  merchant_amount NUMERIC(18,6) NOT NULL DEFAULT 0,
  -- Snapshots
  agreement_ratio_snapshot TEXT,
  deal_terms_snapshot JSONB,
  -- Status
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'settled', 'voided')),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for order_allocations
CREATE INDEX idx_oa_sale_group ON order_allocations(sale_group_id);
CREATE INDEX idx_oa_order ON order_allocations(order_id);
CREATE INDEX idx_oa_relationship ON order_allocations(relationship_id);
CREATE INDEX idx_oa_agreement ON order_allocations(profit_share_agreement_id);
CREATE INDEX idx_oa_merchant ON order_allocations(merchant_id);
CREATE INDEX idx_oa_family ON order_allocations(family);
CREATE INDEX idx_oa_status ON order_allocations(status);

-- ─── RLS Policies ───────────────────────────────────────────────────
ALTER TABLE profit_share_agreements ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_allocations ENABLE ROW LEVEL SECURITY;

-- Profit Share Agreements: relationship members can read
CREATE POLICY "psa_select" ON profit_share_agreements FOR SELECT
  USING (is_relationship_member(relationship_id));

-- Profit Share Agreements: authenticated users can insert
CREATE POLICY "psa_insert" ON profit_share_agreements FOR INSERT
  WITH CHECK (is_relationship_member(relationship_id));

-- Profit Share Agreements: relationship members can update
CREATE POLICY "psa_update" ON profit_share_agreements FOR UPDATE
  USING (is_relationship_member(relationship_id));

-- Order Allocations: relationship members can read
CREATE POLICY "oa_select" ON order_allocations FOR SELECT
  USING (is_relationship_member(relationship_id));

-- Order Allocations: authenticated users can insert
CREATE POLICY "oa_insert" ON order_allocations FOR INSERT
  WITH CHECK (is_relationship_member(relationship_id));

-- Order Allocations: relationship members can update
CREATE POLICY "oa_update" ON order_allocations FOR UPDATE
  USING (is_relationship_member(relationship_id));

-- ─── Auto-expire trigger for agreements ─────────────────────────────
CREATE OR REPLACE FUNCTION auto_expire_agreements()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.expires_at IS NOT NULL AND NEW.expires_at < NOW() AND NEW.status = 'approved' THEN
    NEW.status := 'expired';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_auto_expire_agreements
  BEFORE INSERT OR UPDATE ON profit_share_agreements
  FOR EACH ROW
  EXECUTE FUNCTION auto_expire_agreements();
