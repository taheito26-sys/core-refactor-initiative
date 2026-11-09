import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { bankMisrDisplayPrice } from './display-price';

export interface BankMisrRate {
  /** EGP per 1 QAR note shown to customers: the bank's sell price less the margin. */
  price: number;
  fetchedAt: number;
}

/** The server refreshes the stored rate every 30 minutes; the portal re-reads at the same pace. */
export const BANK_RATE_REFRESH_MS = 30 * 60 * 1000;

// The generated Supabase types predate bank_exchange_rates; drop the cast once they are regenerated.
type UntypedClient = {
  from: (table: string) => {
    select: (cols: string) => {
      match: (q: Record<string, string>) => {
        maybeSingle: () => Promise<{ data: { sell: number | string; fetched_at: string } | null; error: Error | null }>;
      };
    };
  };
};

export function useBankMisrRate() {
  return useQuery({
    queryKey: ['bank-exchange-rate', 'bank_misr', 'QAR', 'notes'],
    refetchInterval: BANK_RATE_REFRESH_MS,
    staleTime: BANK_RATE_REFRESH_MS / 2,
    refetchOnWindowFocus: true,
    retry: 1,
    queryFn: async (): Promise<BankMisrRate | null> => {
      const { data, error } = await (supabase as unknown as UntypedClient)
        .from('bank_exchange_rates')
        .select('sell, fetched_at')
        .match({ bank: 'bank_misr', currency: 'QAR', product: 'notes' })
        .maybeSingle();
      if (error) throw error;
      const price = data ? bankMisrDisplayPrice(Number(data.sell)) : null;
      return data && price !== null ? { price, fetchedAt: new Date(data.fetched_at).getTime() } : null;
    },
  });
}
