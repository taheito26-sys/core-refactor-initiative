import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/auth-context';
import { toast } from 'sonner';

export interface LoanPaymentClaim {
  id: string;
  merchantUserId: string;
  customerUserId: string;
  customerId: string;
  currency: string;
  amount: number;
  note: string | null;
  status: 'pending' | 'accepted' | 'rejected';
  createdAt: string;
  reviewedAt: string | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToClaim(r: any): LoanPaymentClaim {
  return {
    id: r.id,
    merchantUserId: r.merchant_user_id,
    customerUserId: r.customer_user_id,
    customerId: r.customer_id,
    currency: r.currency,
    amount: Number(r.amount),
    note: r.note ?? null,
    status: r.status,
    createdAt: r.created_at,
    reviewedAt: r.reviewed_at ?? null,
  };
}

/**
 * A customer's self-reported payment against a loan, staged in
 * loan_payment_claims until the merchant reviews it -- see the migration
 * comment for why this can't just write into the merchant's tracker state
 * directly. `role` picks which side of the row this caller reads: a
 * customer only ever sees their own submitted claims, a merchant only ever
 * sees claims filed against them.
 */
export function useLoanPaymentClaims(role: 'customer' | 'merchant') {
  const { user } = useAuth();
  const qc = useQueryClient();
  const column = role === 'customer' ? 'customer_user_id' : 'merchant_user_id';

  const query = useQuery({
    queryKey: ['loan-payment-claims', role, user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      const { data, error } = await supabase
        .from('loan_payment_claims' as any)
        .select('*')
        .eq(column, user.id)
        .order('created_at', { ascending: false });
      if (error) {
        console.warn('[useLoanPaymentClaims] query error:', error.message);
        return [];
      }
      return (data ?? []).map(rowToClaim);
    },
    enabled: !!user?.id,
    staleTime: 15000,
  });

  useEffect(() => {
    if (!user?.id) return;
    const channel = supabase
      .channel(`loan-payment-claims-${role}-realtime`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'loan_payment_claims',
      }, () => {
        qc.invalidateQueries({ queryKey: ['loan-payment-claims', role, user.id] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user?.id, role, qc]);

  const submitClaim = useMutation({
    mutationFn: async (input: { merchantUserId: string; customerId: string; currency: string; amount: number; note?: string }) => {
      if (!user?.id) throw new Error('Not authenticated');
      const { error } = await supabase
        .from('loan_payment_claims' as any)
        .insert({
          merchant_user_id: input.merchantUserId,
          customer_user_id: user.id,
          customer_id: input.customerId,
          currency: input.currency,
          amount: input.amount,
          note: input.note ?? null,
        });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['loan-payment-claims', 'customer', user?.id] });
      toast.success('Payment reported to your merchant');
    },
    onError: (err: unknown) => toast.error(err instanceof Error ? err.message : 'Could not submit payment'),
  });

  const reviewClaim = useMutation({
    mutationFn: async (input: { id: string; action: 'accept' | 'reject' }) => {
      const { error } = await supabase
        .from('loan_payment_claims' as any)
        .update({ status: input.action === 'accept' ? 'accepted' : 'rejected', reviewed_at: new Date().toISOString() })
        .eq('id', input.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['loan-payment-claims', 'merchant', user?.id] });
    },
    onError: (err: unknown) => toast.error(err instanceof Error ? err.message : 'Could not update payment claim'),
  });

  return {
    claims: query.data ?? [],
    pending: (query.data ?? []).filter(c => c.status === 'pending'),
    isLoading: query.isLoading,
    submitClaim,
    reviewClaim,
  };
}
