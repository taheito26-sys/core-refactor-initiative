import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { isCompletedP2POrder, type ExchangeP2POrder } from '../types';

/**
 * Completed P2P orders. Orders the merchant resolved without registering
 * (ignored, removed, fixed by hand) are left out unless `includeDismissed`
 * is set, so every list that offers orders for import skips them.
 */
export function useExchangeP2POrders(options: { includeDismissed?: boolean } = {}) {
  const includeDismissed = !!options.includeDismissed;
  return useQuery({
    queryKey: ['exchange-p2p-orders', includeDismissed ? 'all' : 'open'],
    queryFn: async (): Promise<ExchangeP2POrder[]> => {
      const { data, error } = await supabase
        .from('exchange_p2p_orders' as any)
        .select('*')
        .order('order_time', { ascending: false });
      if (error) throw error;
      // Cancelled/pending/failed orders are synced too (so a merchant can
      // still see the exchange's full history elsewhere later), but they
      // must never surface here where the only action is "import into the
      // tracker" — a cancelled order was never real money movement.
      return ((data ?? []) as unknown as ExchangeP2POrder[])
        .filter(o => isCompletedP2POrder(o.status) && (includeDismissed || !o.dismissed_at));
    },
  });
}
