import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/auth-context';

export interface SettlementOverviewItem {
  period_id: string;
  deal_id: string;
  deal_title: string;
  relationship_id: string;
  counterparty_name: string;
  status: string;
  partner_amount: number;
  period_key: string;
  cadence: string;
  due_at: string | null;
}

export interface SettlementOverview {
  dueCount: number;
  overdueCount: number;
  settledThisMonth: number;
  totalOutstanding: number;
  items: SettlementOverviewItem[];
  byRelationship: Map<string, { name: string; items: SettlementOverviewItem[] }>;
}

export function useSettlementOverview() {
  const { merchantProfile } = useAuth();

  return useQuery({
    queryKey: ['settlement-overview'],
    queryFn: async (): Promise<SettlementOverview> => {
      const { data: periods } = await supabase
        .from('settlement_periods')
        .select('*')
        .in('status', ['due', 'overdue', 'pending'])
        .order('due_at', { ascending: true });

      const items: SettlementOverviewItem[] = [];
      const relIds = [...new Set((periods || []).map((p: any) => p.relationship_id))];
      const dealIds = [...new Set((periods || []).map((p: any) => p.deal_id))];

      // Fetch counterparty names
      const relMap = new Map<string, string>();
      if (relIds.length > 0) {
        const { data: rels } = await supabase.from('merchant_relationships').select('*').in('id', relIds);
        const myId = merchantProfile?.merchant_id;
        for (const r of (rels || []) as any[]) {
          const cpId = r.merchant_a_id === myId ? r.merchant_b_id : r.merchant_a_id;
          const { data: profile } = await supabase.from('merchant_profiles').select('display_name').eq('merchant_id', cpId).maybeSingle();
          relMap.set(r.id, profile?.display_name || cpId);
        }
      }

      // Fetch deal titles
      const dealMap = new Map<string, string>();
      if (dealIds.length > 0) {
        const { data: deals } = await supabase.from('merchant_deals').select('id, title').in('id', dealIds);
        (deals || []).forEach(d => dealMap.set(d.id, d.title));
      }

      for (const p of (periods || []) as any[]) {
        items.push({
          period_id: p.id,
          deal_id: p.deal_id,
          deal_title: dealMap.get(p.deal_id) || '—',
          relationship_id: p.relationship_id,
          counterparty_name: relMap.get(p.relationship_id) || '—',
          status: p.status,
          partner_amount: Number(p.partner_amount),
          period_key: p.period_key,
          cadence: p.cadence,
          due_at: p.due_at,
        });
      }

      const byRelationship = new Map<string, { name: string; items: SettlementOverviewItem[] }>();
      for (const item of items) {
        const existing = byRelationship.get(item.relationship_id) || { name: item.counterparty_name, items: [] };
        existing.items.push(item);
        byRelationship.set(item.relationship_id, existing);
      }

      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const { data: settledThisMonthData } = await supabase
        .from('settlement_periods')
        .select('id')
        .eq('status', 'settled')
        .gte('settled_at', monthStart.toISOString());

      return {
        dueCount: items.filter(i => i.status === 'due').length,
        overdueCount: items.filter(i => i.status === 'overdue').length,
        settledThisMonth: settledThisMonthData?.length || 0,
        totalOutstanding: items.reduce((s, i) => s + i.partner_amount, 0),
        items,
        byRelationship,
      };
    },
    enabled: !!merchantProfile,
    staleTime: 60_000,
  });
}
