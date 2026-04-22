import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { ParentOrderSummary } from '../types';

export function useParentOrderSummary(parentOrderId: string | null) {
  return useQuery({
    queryKey: ['parent-order-summary', parentOrderId],
    queryFn: async () => {
      if (!parentOrderId) return null;

      const { data, error } = await supabase
        .from('parent_order_summary')
        .select('*')
        .eq('parent_order_id', parentOrderId)
        .single();

      if (error) {
        // If no summary exists (no executions yet), return default
        if (error.code === 'PGRST116') {
          return null;
        }
        throw error;
      }

      return data as ParentOrderSummary;
    },
    enabled: !!parentOrderId,
  });
}
