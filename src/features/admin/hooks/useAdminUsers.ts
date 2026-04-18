import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface AdminUserRow {
  user_id: string;
  email: string;
  status: string;
  created_at: string;
  merchant_id: string | null;
  display_name: string | null;
  last_active_at: string | null;
  app_session_count: number;
  deal_count: number;
  total_profit: number;
}

export function useAdminUsers(search: string = '') {
  return useQuery({
    queryKey: ['admin-users', search],
    queryFn: async (): Promise<AdminUserRow[]> => {
      const [profilesRes, merchantsRes, dealsRes, profitsRes, appSessionsRes, presenceRes] = await Promise.all([
        supabase
          .from('profiles')
          .select('user_id, email, status, created_at')
          .order('created_at', { ascending: false }),
        supabase
          .from('merchant_profiles')
          .select('user_id, merchant_id, display_name'),
        supabase
          .from('merchant_deals')
          .select('id, created_by'),
        supabase
          .from('merchant_profits')
          .select('amount, recorded_by'),
        supabase
          .from('app_usage_sessions' as any)
          .select('user_id, session_id, last_seen_at'),
        supabase
          .from('chat_presence' as any)
          .select('user_id, last_seen_at'),
      ]);

      if (profilesRes.error) throw profilesRes.error;

      const merchantMap = new Map((merchantsRes.data ?? []).map(m => [m.user_id, m]));
      const dealCounts = new Map<string, number>();
      (dealsRes.data ?? []).forEach(d => {
        dealCounts.set(d.created_by, (dealCounts.get(d.created_by) ?? 0) + 1);
      });
      const profitSums = new Map<string, number>();
      (profitsRes.data ?? []).forEach(p => {
        profitSums.set(p.recorded_by, (profitSums.get(p.recorded_by) ?? 0) + Number(p.amount));
      });
      const activityStats = new Map<string, { last_active_at: string | null; app_session_count: number }>();
      (appSessionsRes.data ?? []).forEach(s => {
        const existing = activityStats.get(s.user_id) ?? { last_active_at: null, app_session_count: 0 };
        existing.app_session_count += 1;
        if (!existing.last_active_at || new Date(String(s.last_seen_at)).getTime() > new Date(existing.last_active_at).getTime()) {
          existing.last_active_at = String(s.last_seen_at);
        }
        activityStats.set(s.user_id, existing);
      });
      (presenceRes.data ?? []).forEach(p => {
        const existing = activityStats.get(p.user_id) ?? { last_active_at: null, app_session_count: 0 };
        if (!existing.last_active_at || new Date(String(p.last_seen_at)).getTime() > new Date(existing.last_active_at).getTime()) {
          existing.last_active_at = String(p.last_seen_at);
        }
        activityStats.set(p.user_id, existing);
      });

      let rows: AdminUserRow[] = (profilesRes.data ?? []).map(p => {
        const m = merchantMap.get(p.user_id);
        const activity = activityStats.get(p.user_id);
        return {
          user_id: p.user_id,
          email: p.email,
          status: p.status,
          created_at: p.created_at,
          merchant_id: m?.merchant_id ?? null,
          display_name: m?.display_name ?? null,
          last_active_at: activity?.last_active_at ?? null,
          app_session_count: activity?.app_session_count ?? 0,
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
