import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface ExchangeOrderLink {
  id: string;
  order_id: string;
  entity_type: 'batch' | 'trade';
  entity_id: string;
  allocated_amount: number;
  customer_label: string | null;
  linked_at: string;
}

/**
 * Fetches every split-allocation row across all of the current user's
 * exchange P2P orders, keyed by order id, so callers can compute how much of
 * each order has actually been registered in the tracker so far (an order
 * can be split across more than one customer/entity).
 */
export function useExchangeOrderLinks() {
  return useQuery({
    queryKey: ['exchange-p2p-order-links'],
    queryFn: async (): Promise<Map<string, ExchangeOrderLink[]>> => {
      const { data, error } = await supabase
        .from('exchange_p2p_order_links' as any)
        .select('*');
      if (error) throw error;
      const byOrder = new Map<string, ExchangeOrderLink[]>();
      for (const row of (data ?? []) as unknown as ExchangeOrderLink[]) {
        const list = byOrder.get(row.order_id) ?? [];
        list.push(row);
        byOrder.set(row.order_id, list);
      }
      return byOrder;
    },
  });
}

export function sumLinkedAmount(links: ExchangeOrderLink[] | undefined): number {
  return (links ?? []).reduce((sum, l) => sum + l.allocated_amount, 0);
}
