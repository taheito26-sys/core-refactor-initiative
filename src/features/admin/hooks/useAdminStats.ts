import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface SystemStats {
  total_users: number;
  approved_users: number;
  pending_users: number;
  rejected_users: number;
  total_deals: number;
  deals_pending: number;
  deals_active: number;
  deals_completed: number;
  deals_cancelled: number;
  total_settlement_amount: number;
  total_profit_amount: number;
  total_merchant_profiles: number;
  total_relationships: number;
}

export function useAdminStats() {
  return useQuery({
    queryKey: ['admin-system-stats'],
    queryFn: async (): Promise<SystemStats> => {
      const { data, error } = await supabase.rpc('admin_system_stats' as any);
      if (error) throw error;
      return data as unknown as SystemStats;
    },
    refetchInterval: 30_000,
  });
}
