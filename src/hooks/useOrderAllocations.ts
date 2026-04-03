// ─── Order Allocations Hook ─────────────────────────────────────────
// Manages per-merchant, per-order allocation records.

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/auth-context';
import type { OrderAllocation, AllocationFamily } from '@/types/domain';
import { calculateOperatorPriorityProfit } from '@/lib/trading/operator-priority';

const ALLOCATIONS_KEY = 'order-allocations';

// ─── Query: Fetch allocations by order ───────────────────────────────

export function useOrderAllocations(orderId?: string) {
  return useQuery({
    queryKey: [ALLOCATIONS_KEY, 'order', orderId],
    queryFn: async (): Promise<OrderAllocation[]> => {
      if (!orderId) return [];
      try {
        const { data, error } = await supabase
          .from('order_allocations' as any)
          .select('*')
          .eq('order_id', orderId)
          .order('created_at', { ascending: true });
        if (error) { console.warn('[useOrderAllocations] Query error:', error.message); return []; }
        return (data || []) as unknown as OrderAllocation[];
      } catch (e) { console.warn('[useOrderAllocations] Failed:', e); return []; }
    },
    enabled: !!orderId,
  });
}

// ─── Query: Fetch allocations by sale group ──────────────────────────

export function useSaleGroupAllocations(saleGroupId?: string) {
  return useQuery({
    queryKey: [ALLOCATIONS_KEY, 'group', saleGroupId],
    queryFn: async (): Promise<OrderAllocation[]> => {
      if (!saleGroupId) return [];
      try {
        const { data, error } = await supabase
          .from('order_allocations' as any)
          .select('*')
          .eq('sale_group_id', saleGroupId)
          .order('created_at', { ascending: true });
        if (error) { console.warn('[useSaleGroupAllocations] Query error:', error.message); return []; }
        return (data || []) as unknown as OrderAllocation[];
      } catch (e) { console.warn('[useSaleGroupAllocations] Failed:', e); return []; }
    },
    enabled: !!saleGroupId,
  });
}

// ─── Query: Fetch allocations by relationship ────────────────────────

export function useRelationshipAllocations(relationshipId?: string) {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: [ALLOCATIONS_KEY, 'relationship', relationshipId],
    queryFn: async (): Promise<OrderAllocation[]> => {
      if (!relationshipId) return [];
      try {
        const { data, error } = await supabase
          .from('order_allocations' as any)
          .select('*')
          .eq('relationship_id', relationshipId)
          .order('created_at', { ascending: false });
        if (error) { console.warn('[useRelationshipAllocations] Query error:', error.message); return []; }
        return (data || []) as unknown as OrderAllocation[];
      } catch (e) { console.warn('[useRelationshipAllocations] Failed:', e); return []; }
    },
    enabled: !!relationshipId,
  });

  // Real-time subscription
  useEffect(() => {
    if (!relationshipId) return;

    const channel = supabase
      .channel(`oa:${relationshipId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'order_allocations',
          filter: `relationship_id=eq.${relationshipId}`,
        },
        () => {
          qc.invalidateQueries({ queryKey: [ALLOCATIONS_KEY] });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [relationshipId, qc]);

  return query;
}

// ─── Mutation: Create allocations (batch) ────────────────────────────

export interface CreateAllocationInput {
  sale_group_id: string;
  order_id: string;
  relationship_id: string;
  merchant_id: string;
  family: AllocationFamily;
  profit_share_agreement_id?: string | null;
  allocated_usdt: number;
  merchant_cost_per_usdt: number;
  sell_price: number;
  fee_share: number;
  allocation_revenue: number;
  allocation_cost: number;
  allocation_fee: number;
  allocation_net: number;
  partner_share_pct: number;
  merchant_share_pct: number;
  partner_amount: number;
  merchant_amount: number;
  agreement_ratio_snapshot?: string | null;
  deal_terms_snapshot?: Record<string, unknown> | null;
  note?: string | null;
}

export function useCreateAllocations() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (allocations: CreateAllocationInput[]) => {
      if (allocations.length === 0) return [];

      const { data, error } = await supabase
        .from('order_allocations' as any)
        .insert(allocations.map(a => ({
          ...a,
          status: 'pending',
        })))
        .select('*');

      if (error) throw error;
      return (data || []) as unknown as OrderAllocation[];
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [ALLOCATIONS_KEY] });
    },
  });
}

// ─── Calculation helpers ─────────────────────────────────────────────

export interface AllocationCalcInput {
  allocatedUsdt: number;
  merchantCostPerUsdt: number;
  sellPrice: number;
  totalFee: number;
  totalUsdt: number;
  family: AllocationFamily;
  partnerSharePct: number;
}

export function calculateAllocationEconomics(input: AllocationCalcInput) {
  const { allocatedUsdt, merchantCostPerUsdt, sellPrice, totalFee, totalUsdt, family, partnerSharePct } = input;

  const revenue = allocatedUsdt * sellPrice;
  const cost = allocatedUsdt * merchantCostPerUsdt;
  // Prorate fee by USDT share
  const feeShare = totalUsdt > 0 ? (allocatedUsdt / totalUsdt) * totalFee : 0;
  const net = revenue - cost - feeShare;

  const merchantSharePct = 100 - partnerSharePct;

  let partnerAmount: number;
  let merchantAmount: number;

  if (family === 'profit_share') {
    // Profit Share: split NET PROFIT
    partnerAmount = net * (partnerSharePct / 100);
    merchantAmount = net - partnerAmount;
  } else if (family === 'sales_deal') {
    // Sales Deal: split NET PROFIT (same as profit share)
    partnerAmount = net * (partnerSharePct / 100);
    merchantAmount = net - partnerAmount;
  } else {
    // Capital Transfer: no split
    partnerAmount = 0;
    merchantAmount = 0;
  }

  return {
    revenue: Math.round(revenue * 100) / 100,
    cost: Math.round(cost * 100) / 100,
    feeShare: Math.round(feeShare * 100) / 100,
    net: Math.round(net * 100) / 100,
    partnerAmount: Math.round(partnerAmount * 100) / 100,
    merchantAmount: Math.round(merchantAmount * 100) / 100,
    partnerSharePct,
    merchantSharePct,
  };
}

/**
 * Operator Priority allocation: uses operator fee + capital-weighted split.
 * Call this instead of calculateAllocationEconomics when the agreement is operator_priority.
 */
export function calculateOperatorPriorityAllocationEconomics(input: AllocationCalcInput & {
  operatorRatio: number;
  operatorContribution: number;
  lenderContribution: number;
  isOperator: boolean;
}) {
  const { allocatedUsdt, merchantCostPerUsdt, sellPrice, totalFee, totalUsdt } = input;

  const revenue = allocatedUsdt * sellPrice;
  const cost = allocatedUsdt * merchantCostPerUsdt;
  const feeShare = totalUsdt > 0 ? (allocatedUsdt / totalUsdt) * totalFee : 0;
  const net = revenue - cost - feeShare;

  // Use the operator priority calculation
  const result = calculateOperatorPriorityProfit({
    grossProfit: net,
    operatorRatio: input.operatorRatio,
    operatorContribution: input.operatorContribution,
    lenderContribution: input.lenderContribution,
  });

  return {
    revenue: Math.round(revenue * 100) / 100,
    cost: Math.round(cost * 100) / 100,
    feeShare: Math.round(feeShare * 100) / 100,
    net: Math.round(net * 100) / 100,
    partnerAmount: Math.round((input.isOperator ? result.lenderTotal : result.operatorTotal) * 100) / 100,
    merchantAmount: Math.round((input.isOperator ? result.operatorTotal : result.lenderTotal) * 100) / 100,
    partnerSharePct: input.isOperator ? result.lenderWeightPct : result.operatorWeightPct,
    merchantSharePct: input.isOperator ? result.operatorWeightPct : result.lenderWeightPct,
    operatorFee: result.operatorFee,
    operatorCapitalShare: result.operatorCapitalShare,
    lenderCapitalShare: result.lenderCapitalShare,
  };
}
