// ─── Settlement Decisions Hook ───────────────────────────────────────
// Manages per-merchant monthly profit handling decisions for operator priority agreements.

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/auth-context';

export type ProfitDecision = 'pending' | 'reinvest' | 'withdraw';
export type DefaultProfitHandling = 'reinvest' | 'withdraw';

export interface SettlementDecision {
  id: string;
  settlement_period_id: string;
  agreement_id: string;
  merchant_id: string;
  role: string;
  profit_amount: number;
  decision: ProfitDecision;
  default_behavior: DefaultProfitHandling;
  decision_due_at: string | null;
  decision_confirmed_at: string | null;
  reinvested_amount: number;
  withdrawn_amount: number;
  effective_capital_before: number;
  effective_capital_after: number;
  finalization_snapshot: Record<string, unknown> | null;
  finalized_at: string | null;
  created_at: string;
  updated_at: string;
}

const SD_KEY = 'settlement-decisions';

/** Fetch settlement decisions for a given period */
export function useSettlementDecisions(periodId?: string) {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: [SD_KEY, periodId],
    queryFn: async (): Promise<SettlementDecision[]> => {
      if (!periodId) return [];
      try {
        const { data, error } = await supabase
          .from('settlement_decisions' as any)
          .select('*')
          .eq('settlement_period_id', periodId)
          .order('created_at', { ascending: true });
        if (error) {
          console.warn('[useSettlementDecisions]', error.message);
          return [];
        }
        return (data || []) as unknown as SettlementDecision[];
      } catch {
        return [];
      }
    },
    enabled: !!periodId,
  });

  // Real-time
  useEffect(() => {
    if (!periodId) return;
    const channel = supabase
      .channel(`sd:${periodId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'settlement_decisions',
        filter: `settlement_period_id=eq.${periodId}`,
      }, () => {
        qc.invalidateQueries({ queryKey: [SD_KEY, periodId] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [periodId, qc]);

  return query;
}

/** Fetch all pending decisions for current merchant across all periods */
export function usePendingDecisions() {
  const { merchantProfile } = useAuth();
  const merchantId = merchantProfile?.merchant_id;

  return useQuery({
    queryKey: [SD_KEY, 'pending', merchantId],
    queryFn: async (): Promise<SettlementDecision[]> => {
      if (!merchantId) return [];
      try {
        const { data, error } = await supabase
          .from('settlement_decisions' as any)
          .select('*')
          .eq('merchant_id', merchantId)
          .eq('decision', 'pending')
          .is('finalized_at', null)
          .order('decision_due_at', { ascending: true });
        if (error) {
          console.warn('[usePendingDecisions]', error.message);
          return [];
        }
        return (data || []) as unknown as SettlementDecision[];
      } catch {
        return [];
      }
    },
    enabled: !!merchantId,
  });
}

/** Merchant submits their monthly profit handling decision */
export function useSubmitDecision() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      decisionId: string;
      decision: 'reinvest' | 'withdraw';
      periodId: string;
    }) => {
      const { error } = await supabase
        .from('settlement_decisions' as any)
        .update({
          decision: input.decision,
          decision_confirmed_at: new Date().toISOString(),
        })
        .eq('id', input.decisionId);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: [SD_KEY, vars.periodId] });
      qc.invalidateQueries({ queryKey: [SD_KEY, 'pending'] });
    },
  });
}

/** Create settlement decisions for a period (called when period becomes due) */
export function useCreateDecisions() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      periodId: string;
      agreementId: string;
      decisions: Array<{
        merchant_id: string;
        role: string;
        profit_amount: number;
        default_behavior: DefaultProfitHandling;
        effective_capital_before: number;
        decision_due_at: string;
      }>;
    }) => {
      const rows = input.decisions.map(d => ({
        settlement_period_id: input.periodId,
        agreement_id: input.agreementId,
        merchant_id: d.merchant_id,
        role: d.role,
        profit_amount: d.profit_amount,
        decision: 'pending',
        default_behavior: d.default_behavior,
        decision_due_at: d.decision_due_at,
        effective_capital_before: d.effective_capital_before,
        effective_capital_after: d.effective_capital_before, // updated on finalization
      }));

      const { error } = await supabase
        .from('settlement_decisions' as any)
        .insert(rows);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: [SD_KEY, vars.periodId] });
    },
  });
}

/**
 * Finalize all decisions for a period:
 * - Pending decisions fall back to default_behavior
 * - Calculate effective_capital_after based on decision
 * - Store immutable finalization_snapshot
 */
export function useFinalizeDecisions() {
  const { userId } = useAuth();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      periodId: string;
      agreementId: string;
      decisions: SettlementDecision[];
      agreementSnapshot: Record<string, unknown>;
    }) => {
      for (const d of input.decisions) {
        const finalDecision: 'reinvest' | 'withdraw' =
          d.decision === 'pending' ? d.default_behavior : (d.decision as 'reinvest' | 'withdraw');

        const reinvestedAmount = finalDecision === 'reinvest' ? d.profit_amount : 0;
        const withdrawnAmount = finalDecision === 'withdraw' ? d.profit_amount : 0;
        const effectiveCapitalAfter = d.effective_capital_before + reinvestedAmount;

        const snapshot = {
          ...input.agreementSnapshot,
          merchant_id: d.merchant_id,
          role: d.role,
          profit_amount: d.profit_amount,
          final_decision: finalDecision,
          was_explicit: d.decision !== 'pending',
          default_behavior: d.default_behavior,
          reinvested_amount: reinvestedAmount,
          withdrawn_amount: withdrawnAmount,
          effective_capital_before: d.effective_capital_before,
          effective_capital_after: effectiveCapitalAfter,
          finalized_by: userId,
        };

        const { error } = await supabase
          .from('settlement_decisions' as any)
          .update({
            decision: finalDecision,
            reinvested_amount: reinvestedAmount,
            withdrawn_amount: withdrawnAmount,
            effective_capital_after: effectiveCapitalAfter,
            finalization_snapshot: snapshot,
            finalized_at: new Date().toISOString(),
          })
          .eq('id', d.id);
        if (error) throw error;
      }
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: [SD_KEY, vars.periodId] });
      qc.invalidateQueries({ queryKey: [SD_KEY, 'pending'] });
    },
  });
}
