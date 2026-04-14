import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export type AdminUserWorkspacePayload = {
  user_id: string;
  merchant_profile: {
    user_id: string;
    merchant_id: string | null;
    display_name: string | null;
    status?: string | null;
    region?: string | null;
    [key: string]: unknown;
  } | null;
  tracker_snapshot: {
    state: unknown | null;
    preferences: unknown | null;
    updated_at: string | null;
  } | null;
  deals: unknown[];
  settlements: unknown[];
  profits: unknown[];
  relationships: unknown[];
  merchant_profiles: unknown[];
};

export function useAdminWorkspace(userId: string | null) {
  return useQuery({
    queryKey: ['admin-user-workspace', userId],
    enabled: !!userId,
    queryFn: async (): Promise<AdminUserWorkspacePayload | null> => {
      const { data, error } = await supabase.rpc('admin_get_user_workspace' as any, {
        _target_user_id: userId!,
      });
      if (error) throw error;
      return (data ?? null) as AdminUserWorkspacePayload | null;
    },
  });
}

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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

export function useAdminCorrectTracker() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ targetUserId, entityType, entityId, updates, reason }: {
      targetUserId: string; entityType: 'batch' | 'trade'; entityId: string; updates: Record<string, unknown>; reason: string;
    }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await supabase.rpc('admin_correct_tracker' as any, {
        _target_user_id: targetUserId,
        _entity_type: entityType,
        _entity_id: entityId,
        _updates: updates,
        _reason: reason,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-user-tracker'] });
      qc.invalidateQueries({ queryKey: ['admin-audit'] });
    },
  });
}

export function useAdminVoidTrackerEntity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ targetUserId, entityType, entityId, reason }: {
      targetUserId: string; entityType: 'batch' | 'trade'; entityId: string; reason: string;
    }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await supabase.rpc('admin_void_tracker_entity' as any, {
        _target_user_id: targetUserId,
        _entity_type: entityType,
        _entity_id: entityId,
        _reason: reason,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-user-tracker'] });
      qc.invalidateQueries({ queryKey: ['admin-audit'] });
    },
  });
}
