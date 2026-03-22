import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/auth-context';

export interface PendingProfile {
  id: string;
  user_id: string;
  email: string;
  status: string;
  created_at: string;
}

export function useAdminProfiles() {
  const { userId } = useAuth();

  return useQuery({
    queryKey: ['admin', 'profiles', 'pending'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, user_id, email, status, created_at')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as PendingProfile[];
    },
    enabled: !!userId,
  });
}

export function useApproveProfile() {
  const qc = useQueryClient();
  const { userId } = useAuth();

  return useMutation({
    mutationFn: async (profileUserId: string) => {
      const { error } = await supabase
        .from('profiles')
        .update({
          status: 'approved',
          approved_at: new Date().toISOString(),
          approved_by: userId,
        })
        .eq('user_id', profileUserId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'profiles'] }),
  });
}

export function useRejectProfile() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ profileUserId, reason }: { profileUserId: string; reason: string }) => {
      const { error } = await supabase
        .from('profiles')
        .update({
          status: 'rejected',
          rejection_reason: reason,
        })
        .eq('user_id', profileUserId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'profiles'] }),
  });
}

export function useIsAdmin() {
  const { userId } = useAuth();

  return useQuery({
    queryKey: ['admin', 'role-check', userId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('has_role', {
        _user_id: userId!,
        _role: 'admin',
      });
      if (error) throw error;
      return data as boolean;
    },
    enabled: !!userId,
  });
}
