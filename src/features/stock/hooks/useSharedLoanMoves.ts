import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/auth-context';
import type { SharedLoanMove } from '../loan-sync';

// The loan-move table is newer than the generated types, so it is reached untyped.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

let channelSeq = 0;

/**
 * Loan movements shared with connected merchants — mine and theirs. A change
 * on either side reaches the other through realtime, so a request appears on
 * the other merchant's Loans page as soon as it is made.
 */
export function useSharedLoanMoves() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const uid = user?.id;
  const key = ['shared-loan-moves', uid];
  // Each mounted copy needs its own channel: the client hands back the same,
  // already-subscribed channel for a repeated name, and adding listeners to
  // that one throws.
  const channelName = useRef(`shared-loan-moves-${uid}-${(channelSeq += 1)}`);

  const query = useQuery({
    queryKey: key,
    enabled: !!uid,
    staleTime: 15_000,
    queryFn: async (): Promise<SharedLoanMove[]> => {
      const { data, error } = await db.from('merchant_loan_moves').select('*').order('created_at', { ascending: false }).limit(300);
      if (error) {
        console.warn('[loan-moves] unavailable:', error.message);
        return [];
      }
      const rows = (data || []) as Record<string, any>[]; // eslint-disable-line @typescript-eslint/no-explicit-any
      const ids = Array.from(new Set(rows.flatMap((r) => [r.proposer_merchant_id, r.responder_merchant_id])));
      const { data: profiles } = ids.length
        ? await supabase.from('merchant_profiles').select('merchant_id, display_name').in('merchant_id', ids)
        : { data: [] };
      const names = new Map(((profiles || []) as { merchant_id: string; display_name: string | null }[]).map((p) => [p.merchant_id, (p.display_name || '').trim() || p.merchant_id]));
      return rows.map((r) => {
        const iAmProposer = r.proposer_user_id === uid;
        return {
          id: r.id,
          direction: r.direction,
          amountUSDT: Number(r.amount_usdt),
          ts: new Date(r.moved_at).getTime(),
          status: r.status,
          iAmProposer,
          counterpartyName: names.get(iAmProposer ? r.responder_merchant_id : r.proposer_merchant_id) || '',
        } as SharedLoanMove;
      });
    },
  });

  useEffect(() => {
    if (!uid) return;
    const refresh = () => { void qc.invalidateQueries({ queryKey: ['shared-loan-moves', uid] }); };
    const channel = supabase
      .channel(channelName.current)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'merchant_loan_moves' }, refresh)
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [uid, qc]);

  const actions = useSharedLoanMoveActions();

  return { moves: query.data ?? [], ...actions };
}

/**
 * Send, answer and withdraw shared loan movements, without loading or
 * watching the list — for the places that only act (the loan dialog).
 */
export function useSharedLoanMoveActions() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const key = ['shared-loan-moves', user?.id];
  const invalidate = () => qc.invalidateQueries({ queryKey: key });

  const propose = useMutation({
    mutationFn: async (a: { relationshipId: string; direction: 'out' | 'in'; amount: number; ts: number }): Promise<string> => {
      const { data, error } = await db.rpc('create_merchant_loan_move', {
        p_relationship_id: a.relationshipId, p_direction: a.direction, p_amount: a.amount, p_moved_at: new Date(a.ts).toISOString(),
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: invalidate,
  });
  const respond = useMutation({
    mutationFn: async (a: { id: string; accept: boolean }) => {
      const { error } = await db.rpc('respond_merchant_loan_move', { p_move_id: a.id, p_accept: a.accept });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
  const cancel = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.rpc('cancel_merchant_loan_move', { p_move_id: id });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  return { propose, respond, cancel };
}
