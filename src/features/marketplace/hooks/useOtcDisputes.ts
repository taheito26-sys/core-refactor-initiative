import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/auth-context';

export interface OtcDispute {
  id: string;
  trade_id: string;
  opened_by: string;
  respondent_user_id: string;
  reason: string;
  evidence_urls: string[];
  respondent_evidence_urls: string[];
  admin_mediator_id: string | null;
  status: 'open' | 'under_review' | 'resolved' | 'closed';
  resolution: string | null;
  resolution_note: string | null;
  created_at: string;
  updated_at: string;
}

export type OpenDisputeInput = {
  trade_id: string;
  respondent_user_id: string;
  reason: string;
};

const DISPUTES_KEY = ['otc', 'disputes'];

export function useOtcDisputes() {
  const { userId } = useAuth();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: DISPUTES_KEY,
    queryFn: async (): Promise<OtcDispute[]> => {
      if (!userId) return [];
      const { data, error } = await supabase
        .from('otc_disputes')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data || []).map(row => ({
        ...row,
        status: row.status as OtcDispute['status'],
      }));
    },
    enabled: !!userId,
  });

  const openDispute = useMutation({
    mutationFn: async (input: OpenDisputeInput) => {
      if (!userId) throw new Error('Not authenticated');
      const { data, error } = await supabase
        .from('otc_disputes')
        .insert({
          trade_id: input.trade_id,
          opened_by: userId,
          respondent_user_id: input.respondent_user_id,
          reason: input.reason,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: DISPUTES_KEY }),
  });

  const addEvidence = useMutation({
    mutationFn: async ({ disputeId, urls, isRespondent }: { disputeId: string; urls: string[]; isRespondent: boolean }) => {
      const field = isRespondent ? 'respondent_evidence_urls' : 'evidence_urls';
      const { data, error } = await supabase
        .from('otc_disputes')
        .update({ [field]: urls })
        .eq('id', disputeId)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: DISPUTES_KEY }),
  });

  return {
    disputes: query.data ?? [],
    isLoading: query.isLoading,
    openDispute,
    addEvidence,
    refetch: query.refetch,
  };
}
