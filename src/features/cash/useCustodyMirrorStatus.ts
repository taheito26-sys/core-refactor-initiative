import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { CustodyMirrorStatus } from './custody-mirror';

// The generated Supabase types predate custody_mirror_status; drop the cast once they are regenerated.
type UntypedClient = {
  rpc: (fn: string) => Promise<{ data: CustodyMirrorStatus[] | null; error: Error | null }>;
};

export function useCustodyMirrorStatus() {
  return useQuery({
    queryKey: ['custody-mirror-status'],
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    retry: 1,
    queryFn: async (): Promise<CustodyMirrorStatus[]> => {
      const { data, error } = await (supabase as unknown as UntypedClient).rpc('custody_mirror_status');
      if (error) throw error;
      return data ?? [];
    },
  });
}
