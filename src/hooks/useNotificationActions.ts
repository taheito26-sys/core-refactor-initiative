/**
 * useNotificationActions
 *
 * Standalone TanStack mutation hooks for inline notification actions
 * used by ActivityCenter — approve/reject deals, accept/decline invites,
 * approve/reject admin profiles, approve/reject settlements.
 *
 * Each hook is kept slim: one mutation, one invalidation target.
 * The hooks are safe to call from inside the notification dropdown
 * without needing the full page context.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/auth-context';

// ─── Deal Approval ─────────────────────────────────────────────────────────

/**
 * Approve an incoming merchant deal by ID.
 * Calls the same `set_merchant_deal_status` RPC used in OrdersPage.
 */
export function useInlineDealApprove() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dealId: string) => {
      const { error } = await supabase.rpc('set_merchant_deal_status', {
        _deal_id: dealId,
        _status: 'approved',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['merchant-deals'] });
      qc.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}

/**
 * Reject an incoming merchant deal by ID.
 */
export function useInlineDealReject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dealId: string) => {
      const { error } = await supabase.rpc('set_merchant_deal_status', {
        _deal_id: dealId,
        _status: 'rejected',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['merchant-deals'] });
      qc.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}

// ─── Invite Accept / Decline ───────────────────────────────────────────────

async function _acceptInvite(inviteId: string) {
  // First fetch the invite to get merchant IDs
  const { data: invite, error: fetchErr } = await supabase
    .from('merchant_invites')
    .select('id, from_merchant_id, to_merchant_id')
    .eq('id', inviteId)
    .single();
  if (fetchErr || !invite) throw fetchErr ?? new Error('Invite not found');

  // Create the relationship
  const { error: relErr } = await supabase.from('merchant_relationships').insert({
    merchant_a_id: invite.from_merchant_id,
    merchant_b_id: invite.to_merchant_id,
    status: 'active',
  });
  if (relErr) throw relErr;

  // Mark invite as accepted
  const { error: invErr } = await supabase
    .from('merchant_invites')
    .update({ status: 'accepted' })
    .eq('id', inviteId);
  if (invErr) throw invErr;
}

export function useInlineInviteAccept() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (inviteId: string) => _acceptInvite(inviteId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['merchant-relationships'] });
      qc.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}

export function useInlineInviteReject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (inviteId: string) => {
      const { error } = await supabase
        .from('merchant_invites')
        .update({ status: 'rejected' })
        .eq('id', inviteId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}

// ─── Admin Profile Approval ────────────────────────────────────────────────

export function useInlineProfileApprove() {
  const { userId } = useAuth();
  const qc = useQueryClient();
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'profiles'] });
      qc.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}

export function useInlineProfileReject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ profileUserId, reason }: { profileUserId: string; reason: string }) => {
      const { error } = await supabase
        .from('profiles')
        .update({ status: 'rejected', rejection_reason: reason })
        .eq('user_id', profileUserId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'profiles'] });
      qc.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}

// ─── Settlement Approval ───────────────────────────────────────────────────

export function useInlineSettlementApprove() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (settlementId: string) => {
      const { error } = await supabase.rpc('approve_settlement', {
        _settlement_id: settlementId,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settlements'] });
      qc.invalidateQueries({ queryKey: ['settlement-periods'] });
      qc.invalidateQueries({ queryKey: ['deal-capital'] });
      qc.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}

export function useInlineSettlementReject() {
  const { userId } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (settlementId: string) => {
      const { error } = await supabase.rpc('reject_settlement', {
        _settlement_id: settlementId,
        _actor_id: userId!,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settlements'] });
      qc.invalidateQueries({ queryKey: ['settlement-periods'] });
      qc.invalidateQueries({ queryKey: ['deal-capital'] });
      qc.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}

// ─── Unified action resolver ───────────────────────────────────────────────

/**
 * Returns which inline action type applies to a given notification,
 * so ActivityCenter can render the right buttons without nesting
 * per-type logic into the render tree.
 */
export type NotificationActionKind =
  | 'deal_approval'       // incoming deal waiting for my approve/reject
  | 'invite_incoming'     // incoming merchant invite
  | 'profile_approval'    // admin: new user waiting for approve/reject
  | 'settlement_approval' // settlement waiting for my approve/reject
  | null;

export function resolveNotificationActionKind(
  category: string,
  entityType: string | null | undefined,
): NotificationActionKind {
  const cat = category.toLowerCase();
  const et = (entityType ?? '').toLowerCase();

  if (cat === 'approval' && (et === 'deal' || et === 'trade' || et === '')) return 'deal_approval';
  if (cat === 'approval' && et === 'profile') return 'profile_approval';
  if (cat === 'approval' && et === 'settlement') return 'settlement_approval';
  if (cat === 'invite' || cat === 'network') return 'invite_incoming';
  if (cat === 'settlement') return 'settlement_approval';
  return null;
}
