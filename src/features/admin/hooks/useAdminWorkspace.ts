import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export function useAdminUserDeals(userId: string | null) {
  return useQuery({
    queryKey: ['admin-user-deals', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('merchant_deals')
        .select('*')
        .eq('created_by', userId!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}

export function useAdminUserSettlements(userId: string | null) {
  return useQuery({
    queryKey: ['admin-user-settlements', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('merchant_settlements')
        .select('*')
        .eq('settled_by', userId!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}

export function useAdminUserProfits(userId: string | null) {
  return useQuery({
    queryKey: ['admin-user-profits', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('merchant_profits')
        .select('*')
        .eq('recorded_by', userId!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}

export function useAdminUserTracker(userId: string | null) {
  return useQuery({
    queryKey: ['admin-user-tracker', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tracker_snapshots')
        .select('state, preferences, updated_at')
        .eq('user_id', userId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

export function useAdminUserProfile(userId: string | null) {
  return useQuery({
    queryKey: ['admin-user-profile', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('merchant_profiles')
        .select('*')
        .eq('user_id', userId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

export function useAdminCorrectDeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ dealId, updates, reason }: { dealId: string; updates: Record<string, unknown>; reason: string }) => {
      const { data, error } = await supabase.rpc('admin_correct_deal' as any, {
        _deal_id: dealId,
        _updates: updates,
        _reason: reason,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-user-deals'] });
      qc.invalidateQueries({ queryKey: ['admin-system-stats'] });
      qc.invalidateQueries({ queryKey: ['admin-audit'] });
    },
  });
}

export function useAdminVoidDeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ dealId, reason }: { dealId: string; reason: string }) => {
      const { data, error } = await supabase.rpc('admin_void_deal' as any, {
        _deal_id: dealId,
        _reason: reason,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-user-deals'] });
      qc.invalidateQueries({ queryKey: ['admin-system-stats'] });
      qc.invalidateQueries({ queryKey: ['admin-audit'] });
    },
  });
}
