/**
 * Hook: useParentOrderSummary
 *
 * Fetches all order_executions for a parent order, computes the aggregated
 * ParentOrderSummary via `computeParentSummary`, and subscribes to Supabase
 * realtime postgres_changes so the summary recomputes on each new execution
 * without a full page reload.
 *
 * Requirements: 3.1–3.14, 6.6, 6.7
 */

import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { computeParentSummary } from '../aggregation';
import type { OrderExecution, ParentOrderSummary } from '../types';

const EXECUTIONS_KEY = 'parent-order-executions';

export function useParentOrderSummary(
  parentOrderId: string,
  parentQarAmount: number,
): {
  summary: ParentOrderSummary | null;
  isLoading: boolean;
  error: Error | null;
} {
  const queryClient = useQueryClient();

  const { data: executions, isLoading, error } = useQuery({
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
        console.warn('[useParentOrderSummary] Query error:', error.message);
        return [];
      }
      return (data ?? []) as unknown as OrderExecution[];
    },
    enabled: !!parentOrderId,
  });

  // ── Realtime subscription: recompute on each postgres_changes event ──
  useEffect(() => {
    if (!parentOrderId) return;

    const channel = supabase
      .channel(`order-executions:${parentOrderId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'order_executions',
          filter: `parent_order_id=eq.${parentOrderId}`,
        },
        () => {
          queryClient.invalidateQueries({
            queryKey: [EXECUTIONS_KEY, parentOrderId],
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [parentOrderId, queryClient]);

  // ── Derive summary from fetched executions ──
  const summary: ParentOrderSummary | null =
    executions && parentOrderId
      ? computeParentSummary(parentOrderId, parentQarAmount, executions)
      : null;

  return {
    summary,
    isLoading,
    error: error as Error | null,
  };
}
