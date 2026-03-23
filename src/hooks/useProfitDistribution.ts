import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/auth-context';
import { getDealShares } from '@/lib/deal-templates';

export interface DealDistribution {
  dealId: string;
  dealTitle: string;
  dealType: string;
  allocationBase: 'net_profit' | 'sale_economics';
  partnerPct: number;
  merchantPct: number;
  totalOrderVolume: number;
  totalNetProfit: number;
  partnerOwed: number;
  merchantOwed: number;
  totalSettled: number;
  partnerOutstanding: number;
}

export interface RelationshipDistribution {
  relationshipId: string;
  counterpartyName: string;
  deals: DealDistribution[];
  summary: {
    totalPartnerOwed: number;
    totalMerchantOwed: number;
    totalSettled: number;
    netOutstanding: number;
  };
}

export function useProfitDistribution(relationshipId: string) {
  const { merchantProfile } = useAuth();

  return useQuery({
    queryKey: ['profit-distribution', relationshipId],
    queryFn: async (): Promise<RelationshipDistribution> => {
      const { data: deals } = await supabase
        .from('merchant_deals')
        .select('*')
        .eq('relationship_id', relationshipId)
        .in('status', ['approved', 'pending']);

      const { data: settlements } = await supabase
        .from('merchant_settlements')
        .select('*')
        .eq('relationship_id', relationshipId)
        .eq('status', 'approved');

      const { data: rel } = await supabase
        .from('merchant_relationships')
        .select('*')
        .eq('id', relationshipId)
        .single();

      const myMerchantId = merchantProfile?.merchant_id;
      const cpMerchantId = rel
        ? (rel.merchant_a_id === myMerchantId ? rel.merchant_b_id : rel.merchant_a_id)
        : null;

      let cpName = 'Counterparty';
      if (cpMerchantId) {
        const { data: cpProfile } = await supabase
          .from('merchant_profiles')
          .select('display_name')
          .eq('merchant_id', cpMerchantId)
          .maybeSingle();
        if (cpProfile) cpName = cpProfile.display_name;
      }

      const dealDistributions: DealDistribution[] = (deals || []).map(deal => {
        const shares = getDealShares({ deal_type: deal.deal_type, notes: deal.notes });

        const dealSettlements = (settlements || [])
          .filter(s => s.deal_id === deal.id)
          .reduce((sum, s) => sum + Number(s.amount), 0);

        const totalOrderVolume = Number(deal.amount || 0);
        const totalNetProfit = Number((deal as any).realized_pnl || 0);

        let partnerOwed = 0;
        let merchantOwed = 0;

        if (shares.partnerPct !== null) {
          if (shares.allocationBase === 'net_profit') {
            partnerOwed = totalNetProfit * (shares.partnerPct / 100);
            merchantOwed = totalNetProfit - partnerOwed;
          } else {
            partnerOwed = totalOrderVolume * (shares.partnerPct / 100);
            merchantOwed = totalOrderVolume - partnerOwed;
          }
        }

        return {
          dealId: deal.id,
          dealTitle: deal.title,
          dealType: deal.deal_type,
          allocationBase: shares.allocationBase,
          partnerPct: shares.partnerPct || 0,
          merchantPct: shares.merchantPct || 0,
          totalOrderVolume,
          totalNetProfit,
          partnerOwed,
          merchantOwed,
          totalSettled: dealSettlements,
          partnerOutstanding: partnerOwed - dealSettlements,
        };
      });

      const summary = {
        totalPartnerOwed: dealDistributions.reduce((s, d) => s + d.partnerOwed, 0),
        totalMerchantOwed: dealDistributions.reduce((s, d) => s + d.merchantOwed, 0),
        totalSettled: dealDistributions.reduce((s, d) => s + d.totalSettled, 0),
        netOutstanding: dealDistributions.reduce((s, d) => s + d.partnerOutstanding, 0),
      };

      return {
        relationshipId,
        counterpartyName: cpName,
        deals: dealDistributions,
        summary,
      };
    },
    enabled: !!relationshipId && !!merchantProfile,
    staleTime: 30_000,
  });
}