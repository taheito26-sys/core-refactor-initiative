import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/auth-context';

export interface Settlement {
  id: string;
  deal_id: string;
  relationship_id: string | null;
  amount: number;
  currency: string;
  settled_by: string;
  notes: string | null;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  deal_title?: string;
  deal_type?: string;
}

export function useSettlements(relationshipId?: string) {
  const { userId } = useAuth();

  return useQuery({
    queryKey: ['settlements', relationshipId],
    queryFn: async (): Promise<Settlement[]> => {
      let query = supabase
        .from('merchant_settlements')
        .select('*, merchant_deals(title, deal_type)')
        .order('created_at', { ascending: false });

      if (relationshipId) {
        query = query.eq('relationship_id', relationshipId);
      }

      const { data, error } = await query;
      if (error) throw error;

      return (data || []).map((s: any) => ({
        ...s,
        deal_title: s.merchant_deals?.title,
        deal_type: s.merchant_deals?.deal_type,
      }));
    },
    enabled: !!userId,
  });
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
          relationship_id: input.relationship_id,
          amount: input.amount,
          currency: input.currency,
          settled_by: userId!,
          notes: input.notes || null,
          status: 'pending',
        });
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
        .update({ status: input.approved ? 'approved' : 'rejected' })
        .eq('id', input.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settlements'] });
    },
  });
}