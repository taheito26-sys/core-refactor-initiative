import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/auth-context';

export interface CapitalEntry {
  id: string;
  deal_id: string;
  relationship_id: string;
  type: 'reinvest' | 'withdrawal' | 'payout';
  amount: number;
  currency: string;
  period_id: string | null;
  initiated_by: string;
  note: string | null;
  pool_balance_after: number;
  created_at: string;
}

export interface DealCapitalSummary {
  dealId: string;
  originalPrincipal: number;
  reinvestedPool: number;
  workingCapital: number;
  totalReinvested: number;
  totalWithdrawn: number;
  totalPaidOut: number;
  ledger: CapitalEntry[];
}

export function useDealCapital(dealId: string, dealAmount: number) {
  return useQuery({
    queryKey: ['deal-capital', dealId],
    queryFn: async (): Promise<DealCapitalSummary> => {
      const { data, error } = await supabase
        .from('deal_capital_ledger')
        .select('*')
        .eq('deal_id', dealId)
        .order('created_at', { ascending: true });
      if (error) throw error;

      const ledger = (data || []) as unknown as CapitalEntry[];
      const lastEntry = ledger.length > 0 ? ledger[ledger.length - 1] : null;
      const reinvestedPool = lastEntry ? Number(lastEntry.pool_balance_after) : 0;

      return {
        dealId,
        originalPrincipal: dealAmount,
        reinvestedPool,
        workingCapital: dealAmount + reinvestedPool,
        totalReinvested: ledger.filter(e => e.type === 'reinvest').reduce((s, e) => s + Number(e.amount), 0),
        totalWithdrawn: ledger.filter(e => e.type === 'withdrawal').reduce((s, e) => s + Number(e.amount), 0),
        totalPaidOut: ledger.filter(e => e.type === 'payout').reduce((s, e) => s + Number(e.amount), 0),
        ledger,
      };
    },
    enabled: !!dealId,
  });
}

/** Merchant action: reinvest partner's profit into capital pool */
export function useReinvestProfit() {
  const qc = useQueryClient();
  const { userId } = useAuth();

  return useMutation({
    mutationFn: async (input: {
      deal_id: string;
      relationship_id: string;
      period_id: string;
      amount: number;
      currency: string;
      current_pool_balance: number;
    }) => {
      const newBalance = input.current_pool_balance + input.amount;

      const { error: ledgerErr } = await supabase
        .from('deal_capital_ledger')
        .insert({
          deal_id: input.deal_id,
          relationship_id: input.relationship_id,
          type: 'reinvest',
          amount: input.amount,
          currency: input.currency,
          period_id: input.period_id,
          initiated_by: userId!,
          pool_balance_after: newBalance,
          note: 'Reinvested from settlement period',
        } as any);
      if (ledgerErr) throw ledgerErr;

      const { error: periodErr } = await supabase
        .from('settlement_periods')
        .update({
          status: 'settled',
          resolution: 'reinvest',
          resolved_by: userId,
          resolved_at: new Date().toISOString(),
          settled_amount: input.amount,
        } as any)
        .eq('id', input.period_id);
      if (periodErr) throw periodErr;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['deal-capital', vars.deal_id] });
      qc.invalidateQueries({ queryKey: ['settlement-periods', vars.relationship_id] });
    },
  });
}

/** Merchant action: pay out partner's profit as cash */
export function usePayoutProfit() {
  const qc = useQueryClient();
  const { userId } = useAuth();

  return useMutation({
    mutationFn: async (input: {
      deal_id: string;
      relationship_id: string;
      period_id: string;
      amount: number;
      currency: string;
      current_pool_balance: number;
    }) => {
      // Create settlement record
      const { data: settlement, error: settErr } = await supabase
        .from('merchant_settlements')
        .insert({
          deal_id: input.deal_id,
          relationship_id: input.relationship_id,
          amount: input.amount,
          currency: input.currency,
          settled_by: userId!,
          notes: 'Payout for settlement period',
          status: 'pending',
        } as any)
        .select('id')
        .single();
      if (settErr) throw settErr;

      // Capital ledger entry (pool unchanged on payout)
      const { error: ledgerErr } = await supabase
        .from('deal_capital_ledger')
        .insert({
          deal_id: input.deal_id,
          relationship_id: input.relationship_id,
          type: 'payout',
          amount: input.amount,
          currency: input.currency,
          period_id: input.period_id,
          initiated_by: userId!,
          pool_balance_after: input.current_pool_balance,
          note: 'Payout for settlement period',
        } as any);
      if (ledgerErr) throw ledgerErr;

      // Mark period settled
      const { error: periodErr } = await supabase
        .from('settlement_periods')
        .update({
          status: 'settled',
          resolution: 'payout',
          resolved_by: userId,
          resolved_at: new Date().toISOString(),
          settled_amount: input.amount,
          settlement_id: (settlement as any).id,
        } as any)
        .eq('id', input.period_id);
      if (periodErr) throw periodErr;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['deal-capital', vars.deal_id] });
      qc.invalidateQueries({ queryKey: ['settlement-periods', vars.relationship_id] });
      qc.invalidateQueries({ queryKey: ['settlements', vars.relationship_id] });
    },
  });
}

/** Partner action: withdraw from reinvested pool */
export function useWithdrawFromPool() {
  const qc = useQueryClient();
  const { userId } = useAuth();

  return useMutation({
    mutationFn: async (input: {
      deal_id: string;
      relationship_id: string;
      amount: number;
      currency: string;
      current_pool_balance: number;
    }) => {
      if (input.amount > input.current_pool_balance) {
        throw new Error('Amount exceeds pool balance');
      }
      const newBalance = input.current_pool_balance - input.amount;

      const { error: ledgerErr } = await supabase
        .from('deal_capital_ledger')
        .insert({
          deal_id: input.deal_id,
          relationship_id: input.relationship_id,
          type: 'withdrawal',
          amount: input.amount,
          currency: input.currency,
          initiated_by: userId!,
          pool_balance_after: newBalance,
          note: 'Partner withdrawal from reinvested pool',
        } as any);
      if (ledgerErr) throw ledgerErr;

      // Create settlement so merchant sees the obligation
      const { error: settErr } = await supabase
        .from('merchant_settlements')
        .insert({
          deal_id: input.deal_id,
          relationship_id: input.relationship_id,
          amount: input.amount,
          currency: input.currency,
          settled_by: userId!,
          notes: 'Withdrawal from reinvested profit pool',
          status: 'pending',
        } as any);
      if (settErr) throw settErr;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['deal-capital', vars.deal_id] });
      qc.invalidateQueries({ queryKey: ['settlements', vars.relationship_id] });
    },
  });
}
