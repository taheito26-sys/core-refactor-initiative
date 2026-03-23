import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { generatePeriods, computePeriodStatus, type Cadence, type PeriodStatus } from '@/lib/settlement-periods';

export interface SettlementPeriod {
  id: string;
  deal_id: string;
  relationship_id: string;
  cadence: Cadence;
  period_key: string;
  period_start: string;
  period_end: string;
  trade_count: number;
  gross_volume: number;
  total_cost: number;
  net_profit: number;
  total_fees: number;
  partner_amount: number;
  merchant_amount: number;
  status: PeriodStatus;
  settled_amount: number;
  settlement_id: string | null;
  resolution: 'payout' | 'reinvest' | null;
  resolved_by: string | null;
  resolved_at: string | null;
  due_at: string | null;
  settled_at: string | null;
  created_at: string;
  deal_title?: string;
  deal_type?: string;
}

export function useSettlementPeriods(relationshipId: string) {
  return useQuery({
    queryKey: ['settlement-periods', relationshipId],
    queryFn: async (): Promise<SettlementPeriod[]> => {
      const { data, error } = await supabase
        .from('settlement_periods')
        .select('*')
        .eq('relationship_id', relationshipId)
        .order('period_end', { ascending: false });
      if (error) throw error;

      const dealIds = [...new Set((data || []).map((p: any) => p.deal_id))];
      const dealMap = new Map<string, { title: string; deal_type: string }>();
      if (dealIds.length > 0) {
        const { data: deals } = await supabase
          .from('merchant_deals')
          .select('id, title, deal_type')
          .in('id', dealIds);
        (deals || []).forEach(d => dealMap.set(d.id, { title: d.title, deal_type: d.deal_type }));
      }

      return (data || []).map((p: any) => ({
        ...p,
        deal_title: dealMap.get(p.deal_id)?.title,
        deal_type: dealMap.get(p.deal_id)?.deal_type,
      })) as SettlementPeriod[];
    },
    enabled: !!relationshipId,
  });
}

/**
 * Sync settlement periods: generates missing periods for weekly/monthly deals
 * and updates status on existing unsettled periods.
 */
export function useSyncSettlementPeriods(relationshipId: string) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (deals: { id: string; settlement_cadence: Cadence; created_at: string }[]) => {
      const now = new Date();

      for (const deal of deals) {
        if (deal.settlement_cadence === 'per_order') continue;

        const periods = generatePeriods(deal.settlement_cadence, deal.created_at, now);

        const { data: existing } = await supabase
          .from('settlement_periods')
          .select('period_key, id, status, settled_amount')
          .eq('deal_id', deal.id);

        const existingKeys = new Set((existing || []).map((e: any) => e.period_key));

        const toInsert = periods
          .filter(p => !existingKeys.has(p.key))
          .map(p => ({
            deal_id: deal.id,
            relationship_id: relationshipId,
            cadence: deal.settlement_cadence,
            period_key: p.key,
            period_start: p.start.toISOString(),
            period_end: p.end.toISOString(),
            due_at: p.dueAt.toISOString(),
            status: computePeriodStatus(p.end, false, now),
            trade_count: 0,
            gross_volume: 0, total_cost: 0, net_profit: 0, total_fees: 0,
            partner_amount: 0, merchant_amount: 0, settled_amount: 0,
          }));

        if (toInsert.length > 0) {
          await supabase.from('settlement_periods').insert(toInsert as any);
        }

        // Update status on unsettled periods
        for (const ep of (existing || []) as any[]) {
          if (ep.status === 'settled') continue;
          const period = periods.find(p => p.key === ep.period_key);
          if (!period) continue;
          const newStatus = computePeriodStatus(period.end, Number(ep.settled_amount) > 0, now);
          if (newStatus !== ep.status) {
            await supabase.from('settlement_periods').update({ status: newStatus } as any).eq('id', ep.id);
          }
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settlement-periods', relationshipId] });
    },
  });
}
