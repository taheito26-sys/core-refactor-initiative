import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/auth-context';

export interface OtcReview {
  id: string;
  trade_id: string;
  reviewer_user_id: string;
  reviewed_user_id: string;
  rating: number;
  comment: string | null;
  created_at: string;
  reviewer_name?: string;
}

const REVIEWS_KEY = (userId: string) => ['otc', 'reviews', userId];

export function useOtcReviews(reviewedUserId: string | null) {
  const query = useQuery({
    queryKey: REVIEWS_KEY(reviewedUserId || ''),
    queryFn: async (): Promise<OtcReview[]> => {
      if (!reviewedUserId) return [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from('otc_reviews')
        .select('*')
        .eq('reviewed_user_id', reviewedUserId)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;

      const reviewerIds: string[] = [...new Set((data || []).map((r: any) => String(r.reviewer_user_id)))];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: profiles } = await (supabase as any)
        .from('merchant_profiles')
        .select('user_id, display_name')
        .in('user_id', reviewerIds);
      const profileMap = new Map((profiles || []).map(p => [p.user_id, p.display_name]));

      return (data || []).map((r: any) => ({
        ...r,
        reviewer_name: profileMap.get(r.reviewer_user_id) ?? 'Unknown',
      }));
    },
    enabled: !!reviewedUserId,
  });

  return { reviews: query.data ?? [], isLoading: query.isLoading };
}

export function useSubmitReview() {
  const { userId } = useAuth();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (input: { trade_id: string; reviewed_user_id: string; rating: number; comment?: string }) => {
      if (!userId) throw new Error('Not authenticated');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from('otc_reviews')
        .insert({
          trade_id: input.trade_id,
          reviewer_user_id: userId,
          reviewed_user_id: input.reviewed_user_id,
          rating: input.rating,
          comment: input.comment || null,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: REVIEWS_KEY(vars.reviewed_user_id) });
      qc.invalidateQueries({ queryKey: ['otc', 'my-trades'] });
    },
  });
}
