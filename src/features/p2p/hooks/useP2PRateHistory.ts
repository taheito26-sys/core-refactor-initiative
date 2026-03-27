import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface P2PSnapshotRow {
  id: string;
  market: string;
  fetched_at: string;
  buyRate: number | null;
  sellRate: number | null;
}

export function useP2PRateHistory(market: string, limit = 20) {
  return useQuery({
    queryKey: ['p2p-rate-history', market, limit],
    queryFn: async (): Promise<P2PSnapshotRow[]> => {
      const { data, error } = await supabase
        .from('p2p_snapshots')
        .select('id, market, fetched_at, data')
        .eq('market', market)
        .order('fetched_at', { ascending: false })
        .limit(limit);

      if (error || !data) return [];

      return data.map((row) => {
        const snapshot = row.data as Record<string, unknown>;
        return {
          id: row.id,
          market: row.market,
          fetched_at: row.fetched_at,
          buyRate: typeof snapshot.buyAvg === 'number' ? snapshot.buyAvg : null,
          sellRate: typeof snapshot.sellAvg === 'number' ? snapshot.sellAvg : null,
        };
      });
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
}
