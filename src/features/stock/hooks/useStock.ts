import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface StockSummary {
  totalDeployed: number;
  pendingAmount: number;
  settledAmount: number;
  profitAmount: number;
  activeDealCount: number;
  currency: string;
}

export interface StockDealRow {
  id: string;
  title: string;
  amount: number;
  currency: string;
  status: string;
  deal_type: string;
  created_at: string;
  settled: number;
  profit: number;
}

export function useStockSummary() {
  return useQuery({
    queryKey: ['stock-summary'],
    queryFn: async (): Promise<StockSummary> => {
      const [dealsRes, settlementsRes, profitsRes] = await Promise.all([
        supabase.from('merchant_deals').select('amount, status, currency'),
        supabase.from('merchant_settlements').select('amount'),
        supabase.from('merchant_profits').select('amount'),
      ]);

      const deals = dealsRes.data ?? [];
      const settlements = settlementsRes.data ?? [];
      const profits = profitsRes.data ?? [];

      const totalDeployed = deals.reduce((s, d) => s + Number(d.amount), 0);
      const pendingAmount = deals
        .filter((d) => d.status === 'pending')
        .reduce((s, d) => s + Number(d.amount), 0);
      const settledAmount = settlements.reduce((s, d) => s + Number(d.amount), 0);
      const profitAmount = profits.reduce((s, d) => s + Number(d.amount), 0);
      const activeDealCount = deals.filter((d) => d.status === 'active' || d.status === 'pending').length;

      return {
        totalDeployed,
        pendingAmount,
        settledAmount,
        profitAmount,
        activeDealCount,
        currency: 'USDT',
      };
    },
  });
}

export function useStockDeals() {
  return useQuery({
    queryKey: ['stock-deals'],
    queryFn: async (): Promise<StockDealRow[]> => {
      const { data: deals } = await supabase
        .from('merchant_deals')
        .select('id, title, amount, currency, status, deal_type, created_at')
        .order('created_at', { ascending: false });

      if (!deals?.length) return [];

      const dealIds = deals.map((d) => d.id);

      const [settlementsRes, profitsRes] = await Promise.all([
        supabase.from('merchant_settlements').select('deal_id, amount').in('deal_id', dealIds),
        supabase.from('merchant_profits').select('deal_id, amount').in('deal_id', dealIds),
      ]);

      const settlementMap = new Map<string, number>();
      (settlementsRes.data ?? []).forEach((s) => {
        settlementMap.set(s.deal_id, (settlementMap.get(s.deal_id) ?? 0) + Number(s.amount));
      });

      const profitMap = new Map<string, number>();
      (profitsRes.data ?? []).forEach((p) => {
        profitMap.set(p.deal_id, (profitMap.get(p.deal_id) ?? 0) + Number(p.amount));
      });

      return deals.map((d) => ({
        ...d,
        amount: Number(d.amount),
        settled: settlementMap.get(d.id) ?? 0,
        profit: profitMap.get(d.id) ?? 0,
      }));
    },
  });
}
