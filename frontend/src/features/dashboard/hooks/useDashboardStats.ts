import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/auth-context';

export interface DashboardStats {
  totalDeployed: number;
  activeCapital: number;
  activeRelationships: number;
  pendingApprovals: number;
}

export function useDashboardStats() {
  const { merchantProfile } = useAuth();
  const merchantId = merchantProfile?.merchant_id;

  return useQuery({
    queryKey: ['dashboard-stats', merchantId],
    queryFn: async (): Promise<DashboardStats> => {
      if (!merchantId) {
        return { totalDeployed: 0, activeCapital: 0, activeRelationships: 0, pendingApprovals: 0 };
      }

      // Fetch relationships
      const { data: relationships } = await supabase
        .from('merchant_relationships')
        .select('id, status')
        .or(`merchant_a_id.eq.${merchantId},merchant_b_id.eq.${merchantId}`);

      const activeRels = relationships?.filter(r => r.status === 'active') ?? [];
      const relIds = activeRels.map(r => r.id);

      let totalDeployed = 0;
      let activeCapital = 0;
      let pendingApprovals = 0;

      if (relIds.length > 0) {
        // Fetch deals for active relationships
        const { data: deals } = await supabase
          .from('merchant_deals')
          .select('amount, status, relationship_id')
          .in('relationship_id', relIds);

        if (deals) {
          totalDeployed = deals.reduce((sum, d) => sum + Number(d.amount), 0);
          activeCapital = deals
            .filter(d => d.status === 'active' || d.status === 'approved')
            .reduce((sum, d) => sum + Number(d.amount), 0);
        }

        // Fetch pending approvals
        const { data: approvals } = await supabase
          .from('merchant_approvals')
          .select('id')
          .in('relationship_id', relIds)
          .eq('status', 'pending');

        pendingApprovals = approvals?.length ?? 0;
      }

      return {
        totalDeployed,
        activeCapital,
        activeRelationships: activeRels.length,
        pendingApprovals,
      };
    },
    enabled: !!merchantId,
    staleTime: 30_000,
  });
}
