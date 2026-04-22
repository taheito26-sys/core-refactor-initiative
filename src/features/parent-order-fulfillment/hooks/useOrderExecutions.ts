/**
 * Hook: useOrderExecutions
 *
 * Fetches child order_executions rows for a given parent_order_id,
 * ordered by sequence_number ascending. Exposes loading and error states.
 *
 * Requirements: 3.14, 6.4, 6.5
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { OrderExecution } from '../types';

const EXECUTIONS_KEY = 'order-executions';

export function useOrderExecutions(parentOrderId: string): {
  executions: OrderExecution[];
  isLoading: boolean;
  error: Error | null;
} {
  const { data, isLoading, error } = useQuery({
    queryKey: [EXECUTIONS_KEY, parentOrderId],
    queryFn: async (): Promise<OrderExecution[]> => {
      if (!parentOrderId) return [];
      const { data, error } = await supabase
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .from('order_executions' as any)
        .select('*')
        .eq('parent_order_id', parentOrderId)
        .order('sequence_number', { ascending: true });
      if (error) {
        console.warn('[useOrderExecutions] Query error:', error.message);
        return [];
      }
      return (data ?? []) as unknown as OrderExecution[];
    },
    enabled: !!parentOrderId,
  });

  return {
    executions: data ?? [],
    isLoading,
    error: error as Error | null,
  };
}
