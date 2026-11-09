import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface BankMisrRate {
  /** EGP the bank pays per 1 QAR note (its buy price). */
  buy: number;
  fetchedAt: number;
}

/** The server refreshes the stored rate every 30 minutes; the portal re-reads at the same pace. */
export const BANK_RATE_REFRESH_MS = 30 * 60 * 1000;

// The generated Supabase types predate bank_exchange_rates; drop the cast once they are regenerated.
type UntypedClient = {
  from: (table: string) => {
    select: (cols: string) => {
      match: (q: Record<string, string>) => {
        maybeSingle: () => Promise<{ data: { buy: number | string; fetched_at: string } | null; error: Error | null }>;
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
        .select('buy, fetched_at')
        .match({ bank: 'bank_misr', currency: 'QAR', product: 'notes' })
        .maybeSingle();
      if (error) throw error;
      const buy = data ? Number(data.buy) : NaN;
      return data && Number.isFinite(buy) ? { buy, fetchedAt: new Date(data.fetched_at).getTime() } : null;
    },
  });
}
