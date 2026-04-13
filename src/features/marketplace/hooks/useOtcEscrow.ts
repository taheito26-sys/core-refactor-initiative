import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/auth-context';

export interface OtcEscrow {
  id: string;
  trade_id: string;
  depositor_user_id: string;
  side: 'cash' | 'usdt';
  amount: number;
  currency: string;
  status: 'pending' | 'deposited' | 'released' | 'disputed';
  deposited_at: string | null;
  released_at: string | null;
  created_at: string;
}

const ESCROW_KEY = (tradeId: string) => ['otc', 'escrow', tradeId];

export function useOtcEscrow(tradeId: string | null) {
  const { userId } = useAuth();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ESCROW_KEY(tradeId || ''),
    queryFn: async (): Promise<OtcEscrow[]> => {
      if (!tradeId) return [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from('otc_escrow')
        .select('*')
        .eq('trade_id', tradeId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data || []) as OtcEscrow[];
    },
    enabled: !!tradeId && !!userId,
  });

  const deposit = useMutation({
    mutationFn: async (input: { trade_id: string; side: 'cash' | 'usdt'; amount: number; currency: string }) => {
      if (!userId) throw new Error('Not authenticated');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from('otc_escrow')
        .upsert({
          trade_id: input.trade_id,
          depositor_user_id: userId,
          side: input.side,
          amount: input.amount,
          currency: input.currency,
          status: 'deposited',
          deposited_at: new Date().toISOString(),
        }, { onConflict: 'trade_id,depositor_user_id' })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ESCROW_KEY(vars.trade_id) });
    },
  });

  const myDeposit = (query.data || []).find(e => e.depositor_user_id === userId);
  const counterDeposit = (query.data || []).find(e => e.depositor_user_id !== userId);
  const bothDeposited = !!myDeposit?.deposited_at && !!counterDeposit?.deposited_at;

  return {
    escrows: query.data ?? [],
    myDeposit,
    counterDeposit,
    bothDeposited,
    isLoading: query.isLoading,
    deposit,
  };
}
