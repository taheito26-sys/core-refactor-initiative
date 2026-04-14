import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export type AdminWorkspaceProfile = {
  user_id: string;
  merchant_id: string | null;
  display_name: string | null;
  status?: string | null;
  region?: string | null;
  nickname?: string | null;
  merchant_code?: string | null;
  [key: string]: unknown;
};

export type AdminUserWorkspacePayload = {
  user_id: string;
  merchant_profile: AdminWorkspaceProfile | null;
  tracker_snapshot: {
    state: unknown | null;
    preferences: unknown | null;
    updated_at: string | null;
  } | null;
  deals: unknown[];
  settlements: unknown[];
  profits: unknown[];
  relationships: unknown[];
  merchant_profiles: AdminWorkspaceProfile[];
};

function normalizeAdminWorkspacePayload(raw: any, requestedUserId: string): AdminUserWorkspacePayload | null {
  if (!raw) return null;

  const candidate = Array.isArray(raw) ? raw[0] : raw;
  const merchantProfiles = Array.isArray(candidate?.merchant_profiles)
    ? candidate.merchant_profiles
    : Array.isArray(candidate?.profiles)
      ? candidate.profiles
      : [];

  const resolvedProfile =
    candidate?.merchant_profile ??
    merchantProfiles.find((p: any) => p?.user_id === requestedUserId) ??
    null;

  return {
    user_id: candidate?.user_id ?? requestedUserId,
    merchant_profile: resolvedProfile,
    tracker_snapshot: candidate?.tracker_snapshot ?? candidate?.trackerSnapshot ?? null,
    deals: Array.isArray(candidate?.deals) ? candidate.deals : [],
    settlements: Array.isArray(candidate?.settlements) ? candidate.settlements : [],
    profits: Array.isArray(candidate?.profits) ? candidate.profits : [],
    relationships: Array.isArray(candidate?.relationships) ? candidate.relationships : [],
    merchant_profiles: merchantProfiles,
  };
}

function isMissingRpcError(error: any): boolean {
  return error?.status === 404 || error?.code === 'PGRST202' || /not found/i.test(String(error?.message ?? ''));
}

async function fetchFallbackAdminWorkspace(userId: string): Promise<AdminUserWorkspacePayload | null> {
  const [profileRes, trackerRes] = await Promise.all([
    supabase
      .from('merchant_profiles')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle(),
    supabase
      .from('tracker_snapshots')
      .select('state, preferences, updated_at')
      .eq('user_id', userId)
      .maybeSingle(),
  ]);

  if (profileRes.error) throw profileRes.error;
  if (trackerRes.error) throw trackerRes.error;

  const profile = (profileRes.data as AdminWorkspaceProfile | null) ?? null;
  const merchantId = profile?.merchant_id ?? null;

  let relationships: any[] = [];
  let deals: any[] = [];
  let settlements: any[] = [];
  let profits: any[] = [];
  let merchantProfiles: AdminWorkspaceProfile[] = profile ? [profile] : [];

  if (merchantId) {
    const relRes = await supabase
      .from('merchant_relationships')
      .select('*')
      .eq('status', 'active')
      .or(`merchant_a_id.eq.${merchantId},merchant_b_id.eq.${merchantId}`);

    if (relRes.error) throw relRes.error;
    relationships = relRes.data ?? [];

    const relIds = relationships.map((rel: any) => rel.id);
    const dealRes = relIds.length > 0
      ? await supabase
        .from('merchant_deals')
        .select('*')
        .in('relationship_id', relIds)
        .order('created_at', { ascending: false })
      : { data: [], error: null };
    if (dealRes.error) throw dealRes.error;
    deals = dealRes.data ?? [];

    const dealIds = deals.map((deal: any) => deal.id);
    const [settledByUserRes, settlementDealsRes, recordedByUserRes, profitDealsRes] = await Promise.all([
      supabase.from('merchant_settlements').select('*').eq('settled_by', userId),
      dealIds.length > 0
        ? supabase.from('merchant_settlements').select('*').in('deal_id', dealIds)
        : Promise.resolve({ data: [], error: null } as any),
      supabase.from('merchant_profits').select('*').eq('recorded_by', userId),
      dealIds.length > 0
        ? supabase.from('merchant_profits').select('*').in('deal_id', dealIds)
        : Promise.resolve({ data: [], error: null } as any),
    ]);

    if (settledByUserRes.error) throw settledByUserRes.error;
    if (settlementDealsRes.error) throw settlementDealsRes.error;
    if (recordedByUserRes.error) throw recordedByUserRes.error;
    if (profitDealsRes.error) throw profitDealsRes.error;

    const settlementMap = new Map<string, any>();
    [...(settledByUserRes.data ?? []), ...(settlementDealsRes.data ?? [])].forEach((row: any) => {
      if (row?.id) settlementMap.set(row.id, row);
    });
    settlements = Array.from(settlementMap.values());

    const profitMap = new Map<string, any>();
    [...(recordedByUserRes.data ?? []), ...(profitDealsRes.data ?? [])].forEach((row: any) => {
      if (row?.id) profitMap.set(row.id, row);
    });
    profits = Array.from(profitMap.values());

    const profilesRes = await supabase
      .from('merchant_profiles')
      .select('*')
      .eq('merchant_id', merchantId)
      .order('display_name', { ascending: true });
    if (profilesRes.error) throw profilesRes.error;
    merchantProfiles = (profilesRes.data ?? []) as AdminWorkspaceProfile[];
  }

  return {
    user_id: userId,
    merchant_profile: profile,
    tracker_snapshot: trackerRes.data ?? null,
    deals,
    settlements,
    profits,
    relationships,
    merchant_profiles: merchantProfiles,
  };
}

export function useAdminWorkspace(userId: string | null) {
  return useQuery({
    queryKey: ['admin-user-workspace', userId],
    enabled: !!userId,
    retry: false,
    queryFn: async (): Promise<AdminUserWorkspacePayload | null> => {
      try {
        const { data, error } = await supabase.rpc('admin_get_user_workspace' as any, {
          _target_user_id: userId!,
        });
        if (error) throw error;
        return normalizeAdminWorkspacePayload(data, userId!);
      } catch (error: any) {
        if (!isMissingRpcError(error)) throw error;
        return fetchFallbackAdminWorkspace(userId!);
      }
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
