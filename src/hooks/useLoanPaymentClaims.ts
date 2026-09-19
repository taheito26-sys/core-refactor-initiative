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
  status: 'pending' | 'accepted' | 'rejected' | 'withdrawn';
  /** When the customer says the payment was actually made -- editable while pending. */
  paidAt: string;
  createdAt: string;
  reviewedAt: string | null;
  /** batchId stamped on the repayments this claim produced, once accepted. */
  appliedBatchId: string | null;
  /** An accepted payment the customer has asked to correct or remove. */
  changeRequest: 'edit' | 'delete' | null;
  changeAmount: number | null;
  changeNote: string | null;
  changePaidAt: string | null;
  /**
   * 'customer_claim' — the normal submit/accept flow. 'merchant_payment' —
   * this row exists only to carry a correction request against a payment
   * the merchant entered directly (no claim was ever submitted for it), so
   * it's inserted pre-accepted with the request already attached.
   */
  source: 'customer_claim' | 'merchant_payment';
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
    paidAt: r.paid_at ?? r.created_at,
    createdAt: r.created_at,
    reviewedAt: r.reviewed_at ?? null,
    appliedBatchId: r.applied_batch_id ?? null,
    changeRequest: r.change_request ?? null,
    changeAmount: r.change_amount == null ? null : Number(r.change_amount),
    changeNote: r.change_note ?? null,
    changePaidAt: r.change_paid_at ?? null,
    source: r.source ?? 'customer_claim',
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
    mutationFn: async (input: { merchantUserId: string; customerId: string; currency: string; amount: number; note?: string; paidAt?: number }) => {
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
          ...(input.paidAt ? { paid_at: new Date(input.paidAt).toISOString() } : {}),
        });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['loan-payment-claims', 'customer', user?.id] });
      toast.success('Payment reported to your merchant');
    },
    onError: (err: unknown) => toast.error(err instanceof Error ? err.message : 'Could not submit payment'),
  });

  /** Corrects a still-pending claim's amount/note/date -- RLS refuses this once a merchant has reviewed it. */
  const updateClaim = useMutation({
    mutationFn: async (input: { id: string; amount: number; note?: string; paidAt: number }) => {
      const { error } = await supabase
        .from('loan_payment_claims' as any)
        .update({
          amount: input.amount,
          note: input.note ?? null,
          paid_at: new Date(input.paidAt).toISOString(),
        })
        .eq('id', input.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['loan-payment-claims', 'customer', user?.id] });
      toast.success('Payment updated');
    },
    onError: (err: unknown) => toast.error(err instanceof Error ? err.message : 'Could not update payment'),
  });

  /** Withdraws a still-pending claim -- RLS refuses this once a merchant has reviewed it. */
  const deleteClaim = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('loan_payment_claims' as any)
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['loan-payment-claims', 'customer', user?.id] });
      toast.success('Payment report deleted');
    },
    onError: (err: unknown) => toast.error(err instanceof Error ? err.message : 'Could not delete payment'),
  });

  const reviewClaim = useMutation({
    mutationFn: async (input: { id: string; action: 'accept' | 'reject'; appliedBatchId?: string }) => {
      const { error } = await supabase
        .from('loan_payment_claims' as any)
        .update({
          status: input.action === 'accept' ? 'accepted' : 'rejected',
          reviewed_at: new Date().toISOString(),
          ...(input.appliedBatchId ? { applied_batch_id: input.appliedBatchId } : {}),
        })
        .eq('id', input.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['loan-payment-claims', 'merchant', user?.id] });
    },
    onError: (err: unknown) => toast.error(err instanceof Error ? err.message : 'Could not update payment claim'),
  });

  /**
   * Customer side: ask the merchant to correct or remove a payment they
   * already accepted. Nothing moves until the merchant applies it -- the
   * repayment it produced lives in their tracker snapshot, not here.
   * `kind: null` cancels an outstanding request.
   */
  const requestChange = useMutation({
    mutationFn: async (input: { id: string; kind: 'edit' | 'delete' | null; amount?: number; note?: string; paidAt?: number }) => {
      const { error } = await supabase.rpc('request_loan_payment_claim_change' as any, {
        p_claim_id: input.id,
        p_kind: input.kind,
        p_amount: input.amount ?? null,
        p_note: input.note ?? null,
        p_paid_at: input.paidAt ? new Date(input.paidAt).toISOString() : null,
      });
      if (error) throw error;
    },
    onSuccess: (_data, input) => {
      qc.invalidateQueries({ queryKey: ['loan-payment-claims', 'customer', user?.id] });
      toast.success(input.kind === null ? 'Request cancelled' : 'Sent to your merchant for review');
    },
    onError: (err: unknown) => toast.error(err instanceof Error ? err.message : 'Could not send the request'),
  });

  /**
   * Customer side: ask for a correction/removal on a payment the merchant
   * entered directly -- there's no claim row for it yet, so this creates
   * one (or updates it, if one is already open) carrying the request.
   */
  const requestMerchantPaymentChange = useMutation({
    mutationFn: async (input: {
      merchantUserId: string; customerId: string; currency: string;
      amount: number; paidAt: number;
      kind: 'edit' | 'delete'; changeAmount?: number; changeNote?: string; changePaidAt?: number;
    }) => {
      const { error } = await supabase.rpc('request_merchant_payment_correction' as any, {
        p_merchant_user_id: input.merchantUserId,
        p_customer_id: input.customerId,
        p_currency: input.currency,
        p_amount: input.amount,
        p_paid_at: new Date(input.paidAt).toISOString(),
        p_kind: input.kind,
        p_change_amount: input.changeAmount ?? null,
        p_change_note: input.changeNote ?? null,
        p_change_paid_at: input.changePaidAt ? new Date(input.changePaidAt).toISOString() : null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['loan-payment-claims', 'customer', user?.id] });
      toast.success('Sent to your merchant for review');
    },
    onError: (err: unknown) => toast.error(err instanceof Error ? err.message : 'Could not send the request'),
  });

  /** Customer side: withdraw a still-open request against a merchant-entered payment. */
  const cancelMerchantPaymentChange = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc('cancel_merchant_payment_correction' as any, { p_claim_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['loan-payment-claims', 'customer', user?.id] });
      toast.success('Request cancelled');
    },
    onError: (err: unknown) => toast.error(err instanceof Error ? err.message : 'Could not cancel the request'),
  });

  /** Merchant side: close out a change request, after applying it to the tracker or declining it. */
  const resolveChange = useMutation({
    mutationFn: async (input: { id: string; action: 'applied' | 'declined' }) => {
      const { error } = await supabase.rpc('resolve_loan_payment_claim_change' as any, {
        p_claim_id: input.id,
        p_action: input.action,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['loan-payment-claims', 'merchant', user?.id] });
    },
    onError: (err: unknown) => toast.error(err instanceof Error ? err.message : 'Could not close the request'),
  });

  return {
    claims: query.data ?? [],
    pending: (query.data ?? []).filter(c => c.status === 'pending'),
    changeRequests: (query.data ?? []).filter(c => c.changeRequest !== null),
    isLoading: query.isLoading,
    submitClaim,
    updateClaim,
    deleteClaim,
    reviewClaim,
    requestChange,
    requestMerchantPaymentChange,
    cancelMerchantPaymentChange,
    resolveChange,
  };
}
