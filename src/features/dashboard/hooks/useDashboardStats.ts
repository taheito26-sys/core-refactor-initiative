import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/auth-context';

export interface DashboardStats {
  totalDeployed: number;
  activeCapital: number;
  activeRelationships: number;
  pendingApprovals: number;
}

/**
 * ISSUE 3 FIX: The previous implementation fetched ALL deals across ALL
 * relationship IDs with no row limit, which would time-out or transfer
 * megabytes of data for merchants with large histories.
 *
 * Immediate frontend guard: cap the deal fetch at 1 000 rows so the query
 * never hangs the UI.  A `.limit()` on the approvals query is added for the
 * same reason.
 *
 * ⚠️ BACKEND TASK FOR LOVABLE: replace the three-round-trip approach with a
 * single fn_get_dashboard_stats(p_merchant_id) RPC that returns
 * { total_deployed, active_capital, active_relationships, pending_approvals }
 * computed entirely in Postgres.  See the Supabase backend prompt for the
 * exact function signature required.
 */
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
      const { data: relationships, error: relError } = await supabase
        .from('merchant_relationships')
        .select('id, status')
        .or(`merchant_a_id.eq.${merchantId},merchant_b_id.eq.${merchantId}`);

      if (relError) throw relError;

      const activeRels = relationships?.filter(r => r.status === 'active') ?? [];
      const relIds = activeRels.map(r => r.id);

      let totalDeployed = 0;
      let activeCapital = 0;
      let pendingApprovals = 0;

      if (relIds.length > 0) {
        // ISSUE 3 FIX: added .limit(1000) — previously unbounded, could fetch
        // millions of rows for active merchants causing UI hangs.
        const { data: deals, error: dealError } = await supabase
          .from('merchant_deals')
          .select('amount, status, relationship_id')
          .in('relationship_id', relIds)
          .limit(1000);

        if (dealError) throw dealError;

        if (deals) {
          totalDeployed = deals.reduce((sum, d) => sum + Number(d.amount), 0);
          activeCapital = deals
            .filter(d => d.status === 'active' || d.status === 'approved')
            .reduce((sum, d) => sum + Number(d.amount), 0);
        }

        const { data: approvals, error: approvalError } = await supabase
          .from('merchant_approvals')
          .select('id')
          .in('relationship_id', relIds)
          .eq('status', 'pending')
          .limit(1000);

        if (approvalError) throw approvalError;

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
