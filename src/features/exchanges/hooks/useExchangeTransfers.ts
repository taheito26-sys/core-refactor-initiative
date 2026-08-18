import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { ExchangeTransfer } from '../types';

export function useExchangeTransfers() {
  return useQuery({
    queryKey: ['exchange-transfers'],
    queryFn: async (): Promise<ExchangeTransfer[]> => {
      const { data, error } = await supabase
        .from('exchange_transfers' as any)
        .select('*')
        .order('transfer_time', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as ExchangeTransfer[];
    },
  });
}
