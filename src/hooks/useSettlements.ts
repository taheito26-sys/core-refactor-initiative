import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/auth-context';
import { useEffect } from 'react';

export interface Settlement {
  id: string;
  deal_id: string;
  relationship_id: string | null;
  amount: number;
  currency: string;
  settled_by: string;
  notes: string | null;
  status: string;
  created_at: string;
  deal_title?: string;
  deal_type?: string;
}

export function useSettlements(relationshipId?: string) {
  const { userId } = useAuth();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ['settlements', relationshipId],
    queryFn: async (): Promise<Settlement[]> => {
      let q = supabase
        .from('merchant_settlements')
        .select('*')
        .order('created_at', { ascending: false });

      if (relationshipId) {
        q = q.eq('relationship_id', relationshipId);
      }

      const { data, error } = await q;
      if (error) throw error;

      const dealIds = [...new Set((data || []).map(s => s.deal_id))];
      const dealMap = new Map<string, { title: string; deal_type: string }>();
      if (dealIds.length > 0) {
        const { data: deals } = await supabase
          .from('merchant_deals')
          .select('id, title, deal_type')
          .in('id', dealIds);
        (deals || []).forEach(d => dealMap.set(d.id, { title: d.title, deal_type: d.deal_type }));
      }

      return (data || []).map(s => ({
        ...s,
        deal_title: dealMap.get(s.deal_id)?.title,
        deal_type: dealMap.get(s.deal_id)?.deal_type,
      }));
    },
    enabled: !!userId,
  });

  // Realtime
  useEffect(() => {
    if (!relationshipId) return;
    const channel = supabase
      .channel(`settlements:${relationshipId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'merchant_settlements', filter: `relationship_id=eq.${relationshipId}` }, () => {
        qc.invalidateQueries({ queryKey: ['settlements', relationshipId] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [relationshipId, qc]);

  return query;
}
export function useSubmitSettlement() {
  const qc = useQueryClient();
  const { userId } = useAuth();

  return useMutation({
    mutationFn: async (input: {
      deal_id: string;
      relationship_id: string;
      amount: number;
      currency: string;
      notes?: string;
    }) => {
      const { error } = await supabase
        .from('merchant_settlements')
        .insert({
          deal_id: input.deal_id,
          relationship_id: input.relationship_id as any,
          amount: input.amount,
          currency: input.currency,
          settled_by: userId!,
          notes: input.notes || null,
          status: 'pending' as any,
        } as any);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['settlements', vars.relationship_id] });
      qc.invalidateQueries({ queryKey: ['settlements'] });
    },
  });
}

export function useApproveSettlement() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (input: { id: string; approved: boolean }) => {
      const { error } = await supabase
        .from('merchant_settlements')
        .update({ status: input.approved ? 'approved' : 'rejected' } as any)
        .eq('id', input.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settlements'] });
    },
  });
}