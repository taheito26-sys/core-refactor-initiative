import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { ExchangeBalance } from '../types';

export function useExchangeBalances() {
  return useQuery({
    queryKey: ['exchange-balances'],
    queryFn: async (): Promise<ExchangeBalance[]> => {
      const { data, error } = await supabase
        .from('exchange_balances' as any)
        .select('*')
        .order('exchange', { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as ExchangeBalance[];
    },
  });
}
