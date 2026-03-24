import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/auth-context';

export interface CapitalTransfer {
  id: string;
  deal_id: string;
  relationship_id: string;
  direction: 'lender_to_operator' | 'operator_to_lender';
  amount: number;
  cost_basis: number;
  total_cost: number;
  currency: string;
  transferred_by: string;
  note: string | null;
  created_at: string;
}

export function useCapitalTransfers(relationshipId: string) {
  return useQuery({
    queryKey: ['capital-transfers', relationshipId],
    queryFn: async (): Promise<CapitalTransfer[]> => {
      const { data, error } = await (supabase
        .from('capital_transfers' as any)
        .select('*')
        .eq('relationship_id', relationshipId)
        .order('created_at', { ascending: false }) as any);
      if (error) throw error;
      return (data || []) as CapitalTransfer[];
    },
    enabled: !!relationshipId,
  });
}

export function useSubmitCapitalTransfer() {
  const qc = useQueryClient();
  const { userId } = useAuth();

  return useMutation({
    mutationFn: async (input: {
      relationship_id: string;
      direction: 'lender_to_operator' | 'operator_to_lender';
      amount: number;
      cost_basis: number;
      note?: string;
    }) => {
      const totalCost = input.amount * input.cost_basis;
      const dirLabel = input.direction === 'lender_to_operator' ? 'Capital In' : 'Capital Return';

      // 1. Create the deal record
      const { data: deal, error: dealErr } = await supabase
        .from('merchant_deals')
        .insert({
          relationship_id: input.relationship_id,
          deal_type: 'capital_transfer',
          title: `${dirLabel} · ${input.amount} USDT @ ${input.cost_basis}`,
          amount: input.amount,
          currency: 'USDT',
          status: 'approved',
          created_by: userId!,
          notes: `direction: ${input.direction} | cost_basis: ${input.cost_basis} | total_cost_qar: ${totalCost}`,
          settlement_cadence: 'monthly',
        } as any)
        .select('id')
        .single();
      if (dealErr) throw dealErr;

      // 2. Create the transfer record
      const { error: txErr } = await (supabase
        .from('capital_transfers' as any)
        .insert({
          deal_id: deal.id,
          relationship_id: input.relationship_id,
          direction: input.direction,
          amount: input.amount,
          cost_basis: input.cost_basis,
          total_cost: totalCost,
          currency: 'USDT',
          transferred_by: userId!,
          note: input.note || null,
        }) as any);
      if (txErr) throw txErr;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['capital-transfers', vars.relationship_id] });
      qc.invalidateQueries({ queryKey: ['merchant-deals'] });
      qc.invalidateQueries({ queryKey: ['balance-ledger', vars.relationship_id] });
    },
  });
}
