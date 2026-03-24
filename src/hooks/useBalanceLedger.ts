import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface BalanceEntry {
  id: string;
  type: 'capital_in' | 'capital_out' | 'reinvest' | 'payout' | 'withdrawal';
  amount: number;
  cost_basis?: number;
  currency: string;
  note: string | null;
  created_at: string;
  running_balance: number;
}

export interface BalanceSummary {
  totalLent: number;
  totalReinvested: number;
  totalPaidOut: number;
  totalWithdrawn: number;
  netBalance: number;
  entries: BalanceEntry[];
}

export function useBalanceLedger(relationshipId: string) {
  return useQuery({
    queryKey: ['balance-ledger', relationshipId],
    queryFn: async (): Promise<BalanceSummary> => {
      const [transfersRes, ledgerRes] = await Promise.all([
        supabase
          .from('capital_transfers' as any)
          .select('*')
          .eq('relationship_id', relationshipId)
          .order('created_at', { ascending: true }) as any,
        supabase
          .from('deal_capital_ledger')
          .select('*')
          .eq('relationship_id', relationshipId)
          .order('created_at', { ascending: true }),
      ]);
      const transfers = transfersRes.data;
      const ledgerEntries = ledgerRes.data;

      const allEvents: { ts: string; entry: BalanceEntry }[] = [];

      for (const tx of (transfers || []) as any[]) {
        const isIn = tx.direction === 'lender_to_operator';
        allEvents.push({
          ts: tx.created_at,
          entry: {
            id: tx.id,
            type: isIn ? 'capital_in' : 'capital_out',
            amount: Number(tx.amount),
            cost_basis: Number(tx.cost_basis),
            currency: tx.currency,
            note: tx.note,
            created_at: tx.created_at,
            running_balance: 0,
          },
        });
      }

      for (const le of (ledgerEntries || []) as any[]) {
        allEvents.push({
          ts: le.created_at,
          entry: {
            id: le.id,
            type: le.type as BalanceEntry['type'],
            amount: Number(le.amount),
            currency: le.currency,
            note: le.note,
            created_at: le.created_at,
            running_balance: 0,
          },
        });
      }

      allEvents.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());

      let runningBalance = 0;
      let totalLent = 0;
      let totalReinvested = 0;
      let totalPaidOut = 0;
      let totalWithdrawn = 0;
      const entries: BalanceEntry[] = [];

      for (const evt of allEvents) {
        const e = evt.entry;
        switch (e.type) {
          case 'capital_in':
            runningBalance += e.amount;
            totalLent += e.amount;
            break;
          case 'capital_out':
            runningBalance -= e.amount;
            totalLent -= e.amount;
            break;
          case 'reinvest':
            runningBalance += e.amount;
            totalReinvested += e.amount;
            break;
          case 'payout':
            totalPaidOut += e.amount;
            break;
          case 'withdrawal':
            runningBalance -= e.amount;
            totalWithdrawn += e.amount;
            break;
        }
        e.running_balance = runningBalance;
        entries.push(e);
      }

      return {
        totalLent,
        totalReinvested,
        totalPaidOut,
        totalWithdrawn,
        netBalance: runningBalance,
        entries: entries.reverse(),
      };
    },
    enabled: !!relationshipId,
  });
}
