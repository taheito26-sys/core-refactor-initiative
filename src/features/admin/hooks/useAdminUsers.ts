import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface AdminUserRow {
  user_id: string;
  email: string;
  status: string;
  created_at: string;
  merchant_id: string | null;
  display_name: string | null;
  deal_count: number;
  total_profit: number;
}

export function useAdminUsers(search: string = '') {
  return useQuery({
    queryKey: ['admin-users', search],
    queryFn: async (): Promise<AdminUserRow[]> => {
      // Fetch profiles
      const { data: profiles, error: pErr } = await supabase
        .from('profiles')
        .select('user_id, email, status, created_at')
        .order('created_at', { ascending: false });
      if (pErr) throw pErr;

      // Fetch merchant profiles
      const { data: merchants } = await supabase
        .from('merchant_profiles')
        .select('user_id, merchant_id, display_name');

      // Fetch deals for counts
      const { data: deals } = await supabase
        .from('merchant_deals')
        .select('id, created_by');

      // Fetch profits
      const { data: profits } = await supabase
        .from('merchant_profits')
        .select('amount, recorded_by');

      const merchantMap = new Map((merchants ?? []).map(m => [m.user_id, m]));
      const dealCounts = new Map<string, number>();
      (deals ?? []).forEach(d => {
        dealCounts.set(d.created_by, (dealCounts.get(d.created_by) ?? 0) + 1);
      });
      const profitSums = new Map<string, number>();
      (profits ?? []).forEach(p => {
        profitSums.set(p.recorded_by, (profitSums.get(p.recorded_by) ?? 0) + Number(p.amount));
      });

      let rows: AdminUserRow[] = (profiles ?? []).map(p => {
        const m = merchantMap.get(p.user_id);
        return {
          user_id: p.user_id,
          email: p.email,
          status: p.status,
          created_at: p.created_at,
          merchant_id: m?.merchant_id ?? null,
          display_name: m?.display_name ?? null,
          deal_count: dealCounts.get(p.user_id) ?? 0,
          total_profit: profitSums.get(p.user_id) ?? 0,
        };
      });

      if (search.trim()) {
        const q = search.toLowerCase();
        rows = rows.filter(r =>
          r.email.toLowerCase().includes(q) ||
          r.merchant_id?.toLowerCase().includes(q) ||
          r.display_name?.toLowerCase().includes(q) ||
          r.user_id.toLowerCase().includes(q)
        );
      }

      return rows;
    },
  });
}
