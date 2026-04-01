// ─── Profit Share Agreements Hook ────────────────────────────────────
// Manages standing profit share agreements with real-time subscriptions.

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/auth-context';
import type { ProfitShareAgreement, AgreementStatus } from '@/types/domain';

const AGREEMENTS_KEY = 'profit-share-agreements';

// ─── Query: Fetch agreements ─────────────────────────────────────────

export function useProfitShareAgreements(relationshipId?: string) {
  const { merchantProfile } = useAuth();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: [AGREEMENTS_KEY, relationshipId],
    queryFn: async (): Promise<ProfitShareAgreement[]> => {
      try {
        let q = supabase
          .from('profit_share_agreements' as any)
          .select('*')
          .order('created_at', { ascending: false });

        if (relationshipId) {
          q = q.eq('relationship_id', relationshipId);
        }

        const { data, error } = await q;
        if (error) {
          // Table may not exist yet — return empty gracefully
          console.warn('[useProfitShareAgreements] Query error (table may not exist):', error.message);
          return [];
        }
        return (data || []) as unknown as ProfitShareAgreement[];
      } catch (e) {
        console.warn('[useProfitShareAgreements] Failed:', e);
        return [];
      }
    },
    enabled: !!merchantProfile?.merchant_id,
  });

  // Real-time subscription
  useEffect(() => {
    const filter = relationshipId
      ? `relationship_id=eq.${relationshipId}`
      : undefined;

    const channel = supabase
      .channel(`psa:${relationshipId || 'all'}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'profit_share_agreements',
          ...(filter ? { filter } : {}),
        },
        () => {
          qc.invalidateQueries({ queryKey: [AGREEMENTS_KEY] });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [relationshipId, qc]);

  return query;
}

// ─── Query: Approved agreements for a specific relationship ──────────

export function useApprovedAgreements(relationshipId: string | undefined) {
  const { merchantProfile } = useAuth();

  return useQuery({
    queryKey: [AGREEMENTS_KEY, 'approved', relationshipId],
    queryFn: async (): Promise<ProfitShareAgreement[]> => {
      if (!relationshipId) return [];

      try {
        const { data, error } = await supabase
          .from('profit_share_agreements' as any)
          .select('*')
          .eq('relationship_id', relationshipId)
          .eq('status', 'approved')
          .order('created_at', { ascending: false });

        if (error) {
          console.warn('[useApprovedAgreements] Query error:', error.message);
          return [];
        }

        // Client-side filter: only agreements that are currently effective
        const now = new Date();
        return ((data || []) as unknown as ProfitShareAgreement[]).filter(a => {
          const from = new Date(a.effective_from);
          if (from > now) return false;
          if (a.expires_at) {
            const until = new Date(a.expires_at);
            if (until < now) return false;
          }
          return true;
        });
      } catch (e) {
        console.warn('[useApprovedAgreements] Failed:', e);
        return [];
      }
    },
    enabled: !!merchantProfile?.merchant_id && !!relationshipId,
  });
}

// ─── Mutation: Create agreement ──────────────────────────────────────

interface CreateAgreementInput {
  relationship_id: string;
  partner_ratio: number;
  merchant_ratio: number;
  settlement_cadence: 'monthly' | 'weekly' | 'per_order';
  invested_capital?: number | null;
  settlement_way?: 'reinvest' | 'withdraw' | null;
  effective_from: string;
  expires_at?: string | null;
  notes?: string | null;
  // Operator Priority fields (optional, only set for operator_priority type)
  agreement_type?: string;
  operator_ratio?: number | null;
  operator_merchant_id?: string | null;
  operator_contribution?: number | null;
  lender_contribution?: number | null;
  terms_snapshot?: Record<string, unknown> | null;
  // Monthly profit handling defaults
  operator_default_profit_handling?: string;
  counterparty_default_profit_handling?: string;
  status?: AgreementStatus;
}

const isSchemaCacheColumnError = (error: unknown): boolean => {
  const message = (error as { message?: string } | null)?.message?.toLowerCase() ?? '';
  return message.includes('schema cache') && message.includes('profit_share_agreements');
};

const stripSharedAgreementFields = <T extends Record<string, unknown>>(input: T): T => {
  const sanitized = { ...input };
  delete sanitized.invested_capital;
  delete sanitized.settlement_way;
  return sanitized;
};

export function useCreateAgreement() {
  const { userId } = useAuth();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateAgreementInput) => {
      const fullPayload = {
        ...input,
        status: input.status || 'pending',
        created_by: userId!,
        // Approved fields should ONLY be set if the status is transition to 'approved'
        approved_by: input.status === 'approved' ? userId! : null,
        approved_at: input.status === 'approved' ? new Date().toISOString() : null,
      };

      const { data, error } = await supabase
        .from('profit_share_agreements' as any)
        .insert(fullPayload)
        .select('*')
        .single();

      if (error && isSchemaCacheColumnError(error)) {
        console.warn('[useCreateAgreement] Schema cache mismatch for "invested_capital". Retrying without shared fields. Please refresh your Supabase schema cache.', error);
        const { data: legacyData, error: legacyError } = await supabase
          .from('profit_share_agreements' as any)
          .insert(stripSharedAgreementFields(fullPayload))
          .select('*')
          .single();
        if (legacyError) throw legacyError;
        return legacyData as unknown as ProfitShareAgreement;
      }

      if (error) throw error;
      return data as unknown as ProfitShareAgreement;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [AGREEMENTS_KEY] });
    },
  });
}

// ─── Mutation: Edit agreement terms ───────────────────────────────────

interface UpdateAgreementInput extends Partial<CreateAgreementInput> {
  agreementId: string;
}

export function useUpdateAgreement() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ agreementId, ...updates }: UpdateAgreementInput) => {
      const { data, error } = await supabase
        .from('profit_share_agreements' as any)
        .update(updates)
        .eq('id', agreementId)
        .select('*')
        .single();

      if (error && isSchemaCacheColumnError(error)) {
        console.warn('[useUpdateAgreement] Schema cache mismatch for "invested_capital". Retrying without shared fields. Please refresh your Supabase schema cache.', error);
        const { data: legacyData, error: legacyError } = await supabase
          .from('profit_share_agreements' as any)
          .update(stripSharedAgreementFields(updates as Record<string, unknown>))
          .eq('id', agreementId)
          .select('*')
          .single();
        if (legacyError) throw legacyError;
        return legacyData as unknown as ProfitShareAgreement;
      }

      if (error) throw error;
      return data as unknown as ProfitShareAgreement;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [AGREEMENTS_KEY] });
    },
  });
}



// ─── Mutation: Update agreement status ───────────────────────────────

interface UpdateStatusInput {
  agreementId: string;
  status: AgreementStatus;
}

export function useUpdateAgreementStatus() {
  const { userId } = useAuth();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ agreementId, status }: UpdateStatusInput) => {
      const updates: Record<string, unknown> = { status };
      if (status === 'approved') {
        updates.approved_by = userId;
        updates.approved_at = new Date().toISOString();
      }

      const { data, error } = await supabase
        .from('profit_share_agreements' as any)
        .update(updates)
        .eq('id', agreementId)
        .select('*')
        .single();

      if (error) throw error;
      return data as unknown as ProfitShareAgreement;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [AGREEMENTS_KEY] });
    },
  });
}
