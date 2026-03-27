import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface P2PRateData {
  buyRate: number | null;
  sellRate: number | null;
  spread: number | null;
  spreadPercent: number | null;
  market: string;
  fetchedAt: string | null;
  isLive: boolean;
}

export function useP2PRates(market = 'qatar') {
  return useQuery({
    queryKey: ['p2p-rates', market],
    queryFn: async (): Promise<P2PRateData> => {
      const { data } = await supabase
        .from('p2p_snapshots')
        .select('data, fetched_at, market')
        .eq('market', market)
        .order('fetched_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!data) {
        return {
          buyRate: null,
          sellRate: null,
          spread: null,
          spreadPercent: null,
          market,
          fetchedAt: null,
          isLive: false,
        };
      }

      const snapshot = data.data as Record<string, unknown>;
      const buyRate = typeof snapshot.buyAvg === 'number' ? snapshot.buyAvg : null;
      const sellRate = typeof snapshot.sellAvg === 'number' ? snapshot.sellAvg : null;
      const spread = buyRate && sellRate ? sellRate - buyRate : null;
      const spreadPercent = spread && buyRate ? (spread / buyRate) * 100 : null;

      const fetchedAt = data.fetched_at;
      const isLive = fetchedAt
        ? Date.now() - new Date(fetchedAt).getTime() < 5 * 60 * 1000
        : false;

      return { buyRate, sellRate, spread, spreadPercent, market, fetchedAt, isLive };
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
}
