import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/auth-context';
import { toast } from 'sonner';

export interface CashCustodyRequest {
  id: string;
  requesterMerchantId: string;
  custodianMerchantId: string;
  amount: number;
  currency: string;
  note?: string;
  status: 'pending' | 'accepted' | 'rejected' | 'counter_proposed' | 'cancelled';
  counterAmount?: number;
  counterNote?: string;
  requesterUserId?: string;
  custodianUserId?: string;
  relationshipId?: string;
  acceptedAt?: string;
  rejectedAt?: string;
  createdAt: string;
  updatedAt: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToRequest(r: any): CashCustodyRequest {
  return {
    id: r.id,
    requesterMerchantId: r.requester_merchant_id,
    custodianMerchantId: r.custodian_merchant_id,
    amount: Number(r.amount),
    currency: r.currency,
    note: r.note ?? undefined,
    status: r.status,
    counterAmount: r.counter_amount ? Number(r.counter_amount) : undefined,
    counterNote: r.counter_note ?? undefined,
    requesterUserId: r.requester_user_id ?? undefined,
    custodianUserId: r.custodian_user_id ?? undefined,
    relationshipId: r.relationship_id ?? undefined,
    acceptedAt: r.accepted_at ?? undefined,
    rejectedAt: r.rejected_at ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function useCashCustodyRequests() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ['cash-custody-requests'],
    queryFn: async () => {
      if (!user?.id) return [];
      try {
        const { data, error } = await supabase
          .from('cash_custody_requests')
          .select('*')
          .or(`requester_user_id.eq.${user.id},custodian_user_id.eq.${user.id}`)
          .order('created_at', { ascending: false });
        if (error) {
          // Table may not exist yet — fail gracefully
          console.warn('[useCashCustodyRequests] query error:', error.message);
          return [];
        }
        return (data ?? []).map((r) => rowToRequest(r));
      } catch (err) {
        console.warn('[useCashCustodyRequests] unexpected error:', err);
        return [];
      }
    },
    enabled: !!user?.id,
    staleTime: 30000,
  });

  // Realtime subscription
  useEffect(() => {
    if (!user?.id) return;
    const channel = supabase
      .channel('cash-custody-requests-realtime')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .on('postgres_changes' as any, {
        event: '*',
        schema: 'public',
        table: 'cash_custody_requests',
      }, () => {
        qc.invalidateQueries({ queryKey: ['cash-custody-requests'] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user?.id, qc]);

  const createRequest = useMutation({
    mutationFn: async (input: {
      custodianMerchantId: string;
      custodianUserId: string;
      requesterMerchantId: string;
      amount: number;
      currency: string;
      note?: string;
      relationshipId?: string;
    }) => {
      if (!user?.id) throw new Error('Not authenticated');
      const { data, error } = await supabase
        .from('cash_custody_requests')
        .insert({
          requester_merchant_id: input.requesterMerchantId,
          custodian_merchant_id: input.custodianMerchantId,
          amount: input.amount,
          currency: input.currency,
          note: input.note ?? null,
          status: 'pending',
          requester_user_id: user.id,
          custodian_user_id: input.custodianUserId,
          relationship_id: input.relationshipId ?? null,
        })
        .select()
        .single();
      if (error) throw error;
      return rowToRequest(data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cash-custody-requests'] });
      toast.success('Cash custody request sent');
    },
    onError: () => toast.error('Failed to send custody request'),
  });

  const respondRequest = useMutation({
    mutationFn: async (input: {
      id: string;
      action: 'accept' | 'reject' | 'counter';
      counterAmount?: number;
      counterNote?: string;
    }) => {
      const updates: Record<string, unknown> = {};
      if (input.action === 'accept') {
        updates.status = 'accepted';
        updates.accepted_at = new Date().toISOString();
      } else if (input.action === 'reject') {
        updates.status = 'rejected';
        updates.rejected_at = new Date().toISOString();
      } else {
        updates.status = 'counter_proposed';
        updates.counter_amount = input.counterAmount;
        updates.counter_note = input.counterNote ?? null;
      }
      const { error } = await supabase
        .from('cash_custody_requests')
        .update(updates)
        .eq('id', input.id);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['cash-custody-requests'] });
      const labels: Record<'accept' | 'reject' | 'counter', string> = { accept: 'accepted', reject: 'rejected', counter: 'counter-proposed' };
      toast.success(`Request ${labels[vars.action]}`);
    },
    onError: () => toast.error('Failed to update request'),
  });

  const cancelRequest = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .from('cash_custody_requests') as any)
        .update({ status: 'cancelled' })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cash-custody-requests'] });
      toast.success('Request cancelled');
    },
    onError: () => toast.error('Failed to cancel'),
  });

  const pendingIncoming = (query.data ?? []).filter(r => r.status === 'pending' && r.custodianUserId === user?.id);
  const pendingOutgoing = (query.data ?? []).filter(r => r.status === 'pending' && r.requesterUserId === user?.id);

  return {
    requests: query.data ?? [],
    pendingIncoming,
    pendingOutgoing,
    isLoading: query.isLoading,
    createRequest,
    respondRequest,
    cancelRequest,
  };
}
