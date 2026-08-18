import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { ExchangeP2POrder } from '../types';

export function useExchangeP2POrders() {
  return useQuery({
    queryKey: ['exchange-p2p-orders'],
    queryFn: async (): Promise<ExchangeP2POrder[]> => {
      const { data, error } = await supabase
        .from('exchange_p2p_orders' as any)
        .select('*')
        .order('order_time', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as ExchangeP2POrder[];
    },
  });
}
