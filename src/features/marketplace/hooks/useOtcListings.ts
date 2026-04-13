import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/auth-context';
import { useEffect } from 'react';

export interface OtcListing {
  id: string;
  user_id: string;
  merchant_id: string;
  side: 'cash' | 'usdt';
  currency: string;
  amount_min: number;
  amount_max: number;
  rate: number;
  payment_methods: string[];
  note: string | null;
  status: 'active' | 'paused' | 'expired';
  expires_at: string | null;
  created_at: string;
  updated_at: string;
  // joined
  merchant_name?: string;
  merchant_nickname?: string;
  // reputation
  otc_completed_trades?: number;
  otc_completion_rate?: number;
  otc_total_volume?: number;
}

export type CreateListingInput = {
  side: 'cash' | 'usdt';
  currency: string;
  amount_min: number;
  amount_max: number;
  rate: number;
  payment_methods: string[];
  note?: string;
  expires_at?: string;
};

const LISTINGS_KEY = ['otc', 'listings'];
const MY_LISTINGS_KEY = ['otc', 'my-listings'];

export function useOtcListings() {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: LISTINGS_KEY,
    queryFn: async (): Promise<OtcListing[]> => {
      const { data, error } = await supabase
        .from('otc_listings')
        .select('*')
        .eq('status', 'active')
        .order('updated_at', { ascending: false })
        .limit(200);
      if (error) throw error;

      // Enrich with merchant names
      const userIds = [...new Set((data || []).map(d => d.user_id))];
      const { data: profiles } = await supabase
        .from('merchant_profiles')
        .select('user_id, display_name, nickname, otc_completed_trades, otc_completion_rate, otc_total_volume')
        .in('user_id', userIds);
      const profileMap = new Map((profiles || []).map(p => [p.user_id, p]));

      return (data || []).map(row => {
        const prof = profileMap.get(row.user_id);
        return {
          ...row,
          side: row.side as 'cash' | 'usdt',
          status: row.status as 'active' | 'paused' | 'expired',
          merchant_name: prof?.display_name ?? row.merchant_id,
          merchant_nickname: prof?.nickname ?? '',
          otc_completed_trades: prof?.otc_completed_trades ?? 0,
          otc_completion_rate: prof?.otc_completion_rate ?? 0,
          otc_total_volume: prof?.otc_total_volume ?? 0,
        };
      });
    },
    staleTime: 15_000,
  });

  // Realtime refresh
  useEffect(() => {
    const channel = supabase
      .channel('otc-listings-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'otc_listings' }, () => {
        qc.invalidateQueries({ queryKey: LISTINGS_KEY });
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [qc]);

  return {
    listings: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}

export function useMyOtcListings() {
  const { userId, merchantProfile } = useAuth();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: MY_LISTINGS_KEY,
    queryFn: async (): Promise<OtcListing[]> => {
      if (!userId) return [];
      const { data, error } = await supabase
        .from('otc_listings')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []).map(row => ({
        ...row,
        side: row.side as 'cash' | 'usdt',
        status: row.status as 'active' | 'paused' | 'expired',
      }));
    },
    enabled: !!userId,
  });

  const create = useMutation({
    mutationFn: async (input: CreateListingInput) => {
      if (!userId || !merchantProfile) throw new Error('Not authenticated');
      const { data, error } = await supabase
        .from('otc_listings')
        .insert({
          user_id: userId,
          merchant_id: merchantProfile.merchant_id,
          side: input.side,
          currency: input.currency,
          amount_min: input.amount_min,
          amount_max: input.amount_max,
          rate: input.rate,
          payment_methods: input.payment_methods,
          note: input.note || null,
          expires_at: input.expires_at || null,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: MY_LISTINGS_KEY });
      qc.invalidateQueries({ queryKey: LISTINGS_KEY });
    },
  });

  const update = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<OtcListing> & { id: string }) => {
      const { data, error } = await supabase
        .from('otc_listings')
        .update(updates)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: MY_LISTINGS_KEY });
      qc.invalidateQueries({ queryKey: LISTINGS_KEY });
    },
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('otc_listings').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: MY_LISTINGS_KEY });
      qc.invalidateQueries({ queryKey: LISTINGS_KEY });
    },
  });

  return {
    myListings: query.data ?? [],
    isLoading: query.isLoading,
    create,
    update,
    remove,
  };
}
