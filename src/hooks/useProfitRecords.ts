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
  status: string;
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
        .select('*')
        .order('created_at', { ascending: false });

      if (relationshipId) {
        query = query.eq('relationship_id', relationshipId);
      }

      const { data, error } = await query;
      if (error) throw error;

      // Fetch deal titles separately
      const dealIds = [...new Set((data || []).map(p => p.deal_id))];
      const dealMap = new Map<string, { title: string; deal_type: string }>();
      if (dealIds.length > 0) {
        const { data: deals } = await supabase
          .from('merchant_deals')
          .select('id, title, deal_type')
          .in('id', dealIds);
        (deals || []).forEach(d => dealMap.set(d.id, { title: d.title, deal_type: d.deal_type }));
      }

      return (data || []).map(p => ({
        ...p,
        deal_title: dealMap.get(p.deal_id)?.title,
        deal_type: dealMap.get(p.deal_id)?.deal_type,
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
          relationship_id: input.relationship_id as any,
          amount: input.amount,
          currency: input.currency,
          recorded_by: userId!,
          notes: input.notes || null,
          status: 'pending' as any,
        } as any);
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
        .update({ status: input.approved ? 'approved' : 'rejected' } as any)
        .eq('id', input.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['profit-records'] });
    },
  });
}