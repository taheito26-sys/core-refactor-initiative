import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { OrderExecution } from '../types';

export function useOrderExecutions(parentOrderId: string | null) {
  return useQuery({
    queryKey: ['order-executions', parentOrderId],
    queryFn: async () => {
      if (!parentOrderId) return [];

      const { data, error } = await supabase
        .from('order_executions')
        .select('*')
        .eq('parent_order_id', parentOrderId)
        .order('sequence_number', { ascending: true });

      if (error) throw error;
      return (data ?? []) as OrderExecution[];
    },
    enabled: !!parentOrderId,
  });
}
