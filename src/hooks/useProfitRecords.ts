import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/auth-context';

export interface ProfitRecord {
  id: string;
  deal_id: string;
  relationship_id: string | null;
  amount: number;
  currency: string;
  recorded_by: string;
  notes: string | null;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  deal_title?: string;
  deal_type?: string;
}

export function useProfitRecords(relationshipId?: string) {
  const { userId } = useAuth();

  return useQuery({
    queryKey: ['profit-records', relationshipId],
    queryFn: async (): Promise<ProfitRecord[]> => {
      let query = supabase
        .from('merchant_profits')
        .select('*, merchant_deals(title, deal_type)')
        .order('created_at', { ascending: false });

      if (relationshipId) {
        query = query.eq('relationship_id', relationshipId);
      }

      const { data, error } = await query;
      if (error) throw error;

      return (data || []).map((p: any) => ({
        ...p,
        deal_title: p.merchant_deals?.title,
        deal_type: p.merchant_deals?.deal_type,
      }));
    },
    enabled: !!userId,
  });
}

export function useSubmitProfit() {
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
        .from('merchant_profits')
        .insert({
          deal_id: input.deal_id,
          relationship_id: input.relationship_id,
          amount: input.amount,
          currency: input.currency,
          recorded_by: userId!,
          notes: input.notes || null,
          status: 'pending',
        });
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['profit-records', vars.relationship_id] });
      qc.invalidateQueries({ queryKey: ['profit-records'] });
    },
  });
}

export function useApproveProfit() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (input: { id: string; approved: boolean }) => {
      const { error } = await supabase
        .from('merchant_profits')
        .update({ status: input.approved ? 'approved' : 'rejected' })
        .eq('id', input.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['profit-records'] });
    },
  });
}