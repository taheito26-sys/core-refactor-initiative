import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { generatePeriods, computePeriodStatus, type Cadence, type PeriodStatus } from '@/lib/settlement-periods';
import { useAuth } from '@/features/auth/auth-context';
import { calculateAgreementAllocation } from '@/lib/deal-engine';

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
 * Sync settlement periods: generates missing periods for weekly/monthly deals,
 * aggregates real trade economics into each period, and updates status.
 */
export function useSyncSettlementPeriods(relationshipId: string) {
  const qc = useQueryClient();
  const { merchantProfile } = useAuth();

  return useMutation({
    mutationFn: async (input: {
      deals: { id: string; settlement_cadence: Cadence; created_at: string }[];
      trades: Array<{
        id: string;
        ts: number;
        linkedDealId?: string;
        amountUSDT: number;
        sellPriceQAR: number;
        feeQAR: number;
        voided: boolean;
      }>;
      tradeCalc: Map<string, any>;
    }) => {
      const now = new Date();
      const { deals, trades, tradeCalc } = input;

      for (const deal of deals) {
        if (deal.settlement_cadence === 'per_order') continue;

        const periods = generatePeriods(deal.settlement_cadence, deal.created_at, now);

        const { data: existing } = await supabase
          .from('settlement_periods')
          .select('period_key, id, status, settled_amount')
          .eq('deal_id', deal.id);

        const existingMap = new Map((existing || []).map((e: any) => [e.period_key, e]));

        // Find local trades linked to this deal
        const linkedTrades = trades.filter(t => !t.voided && t.linkedDealId === deal.id);

        // Fetch deal metadata once per deal for share computation
        const { data: dealMeta } = await supabase
          .from('merchant_deals')
          .select('deal_type, notes')
          .eq('id', deal.id)
          .single();

        let partnerPct = 0;
        if (dealMeta?.notes) {
          const ratioMatch = (dealMeta.notes as string).match(/(?:partner_ratio|counterparty_share_pct):\s*(\d+)/);
          if (ratioMatch) partnerPct = Number(ratioMatch[1]);
        }

        let agreement: any = null;
        // Parse agreement ID from pipe-separated notes metadata
        const agreementIdMatch = dealMeta?.notes ? (dealMeta.notes as string).match(/profit_share_agreement_id:\s*([a-f0-9-]+)/) : null;
        const agreementId = agreementIdMatch ? agreementIdMatch[1] : null;
        if (agreementId) {
          const { data: agr } = await supabase
            .from('profit_share_agreements' as any)
            .select('*')
            .eq('id', agreementId)
            .single();
          agreement = agr;
        }

        for (const period of periods) {
          const periodStart = period.start.getTime();
          const periodEnd = period.end.getTime();

          const periodTrades = linkedTrades.filter(t => t.ts >= periodStart && t.ts <= periodEnd);

          let grossVolume = 0;
          let totalCost = 0;
          let totalFees = 0;
          let netProfit = 0;

          for (const t of periodTrades) {
            const rev = t.amountUSDT * t.sellPriceQAR;
            const calc = tradeCalc.get(t.id);
            const cost = calc?.ok ? calc.slices.reduce((s, sl) => s + sl.cost, 0) : 0;
            grossVolume += rev;
            totalCost += cost;
            totalFees += t.feeQAR;
            netProfit += calc?.ok ? calc.netQAR : (rev - cost - t.feeQAR);
          }

          const allocationBase = (dealMeta as any)?.deal_type === 'partnership' ? netProfit : grossVolume;
          let partnerAmount = allocationBase * (partnerPct / 100);
          let merchantAmount = allocationBase - partnerAmount;

          if (agreement) {
            const isOperator = agreement.operator_merchant_id === merchantProfile?.merchant_id;
            const alloc = calculateAgreementAllocation(
              agreement,
              grossVolume,
              totalCost,
              totalFees,
              { isOperator },
            );
            partnerAmount = alloc.partnerAmount;
            merchantAmount = alloc.merchantAmount;
          }

          const ep = existingMap.get(period.key);

          if (!ep) {
            await supabase.from('settlement_periods').insert({
              deal_id: deal.id,
              relationship_id: relationshipId,
              cadence: deal.settlement_cadence,
              period_key: period.key,
              period_start: period.start.toISOString(),
              period_end: period.end.toISOString(),
              due_at: period.dueAt.toISOString(),
              status: computePeriodStatus(period.end, false, now),
              trade_count: periodTrades.length,
              gross_volume: grossVolume,
              total_cost: totalCost,
              net_profit: netProfit,
              total_fees: totalFees,
              partner_amount: partnerAmount,
              merchant_amount: merchantAmount,
              settled_amount: 0,
            } as any);
          } else if (ep.status !== 'settled') {
            const newStatus = computePeriodStatus(period.end, Number(ep.settled_amount) > 0, now);
            await supabase.from('settlement_periods').update({
              trade_count: periodTrades.length,
              gross_volume: grossVolume,
              total_cost: totalCost,
              net_profit: netProfit,
              total_fees: totalFees,
              partner_amount: partnerAmount,
              merchant_amount: merchantAmount,
              status: newStatus,
            } as any).eq('id', ep.id);
          }
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settlement-periods', relationshipId] });
    },
  });
}
