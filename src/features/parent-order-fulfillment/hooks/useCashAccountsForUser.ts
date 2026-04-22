/**
 * Hook: useCashAccountsForUser
 *
 * Queries cash accounts scoped to the authenticated customer's user_id.
 * Filters out merchant accounts (is_merchant_account = true) at the query
 * layer — never exposes accounts belonging to a different user.
 *
 * Requirements: 7.2, 8.1, 8.2, 8.3, 8.4
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/auth-context';
import type { CashAccount } from '../types';

const CASH_ACCOUNTS_KEY = 'customer-cash-accounts-for-user';

export function useCashAccountsForUser(): {
  accounts: CashAccount[];
  isLoading: boolean;
  error: Error | null;
} {
  const { userId } = useAuth();

  const { data, isLoading, error } = useQuery({
    queryKey: [CASH_ACCOUNTS_KEY, userId],
    queryFn: async (): Promise<CashAccount[]> => {
      if (!userId) return [];
      const { data, error } = await supabase
        .from('cash_accounts')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'active')
        .order('created_at', { ascending: false });
      if (error) {
        console.warn('[useCashAccountsForUser] Query error:', error.message);
        return [];
      }
      // Filter out merchant accounts at the data layer.
      // The DB column is `is_merchant_account` (boolean).
      // We also exclude `merchant_custody` type accounts for safety.
      const rows = (data ?? []) as Record<string, unknown>[];
      return rows
        .filter((row) => {
          if (row.is_merchant_account === true) return false;
          if (row.type === 'merchant_custody') return false;
          return true;
        })
        .map((row) => ({
          id: row.id as string,
          name: row.name as string,
          type: row.type as CashAccount['type'],
          currency: row.currency as CashAccount['currency'],
          status: (row.status as CashAccount['status']) ?? 'active',
          bankName: row.bank_name as string | undefined,
          branch: row.branch as string | undefined,
          nickname: row.nickname as string | undefined,
          notes: row.notes as string | undefined,
          createdAt: new Date(row.created_at as string).getTime(),
          isMerchantAccount: false,
        })) as CashAccount[];
    },
    enabled: !!userId,
  });

  return {
    accounts: data ?? [],
    isLoading,
    error: error as Error | null,
  };
}
