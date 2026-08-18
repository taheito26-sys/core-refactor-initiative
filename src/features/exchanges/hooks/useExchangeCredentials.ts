import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { ExchangeCredential } from '../types';

export function useExchangeCredentials() {
  return useQuery({
    queryKey: ['exchange-credentials'],
    queryFn: async (): Promise<ExchangeCredential[]> => {
      const { data, error } = await supabase
        .from('exchange_credentials' as any)
        .select('id, exchange, label, api_key, last_synced_at, last_sync_error, created_at')
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as ExchangeCredential[];
    },
  });
}

export function useInvalidateExchangeData() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['exchange-credentials'] });
    qc.invalidateQueries({ queryKey: ['exchange-balances'] });
    qc.invalidateQueries({ queryKey: ['exchange-p2p-orders'] });
  };
}
