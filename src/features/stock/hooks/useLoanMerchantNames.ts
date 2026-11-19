import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/auth-context';
import type { TrackerState } from '@/lib/tracker-helpers';
import { buildMerchantStatements } from '../loan-ledger';

export interface LoanMerchantOption {
  name: string;
  /** Net USDT position: > 0 I owe them, < 0 they owe me; undefined when there is no loan history yet. */
  net?: number;
  connected: boolean;
  /** The active relationship with this merchant, when connected — what shared loan movements are sent through. */
  relationshipId?: string;
}

/** Display names of the merchants this merchant has an active relationship with. */
function useConnectedMerchantNames() {
  const { user } = useAuth();
  const uid = user?.id;
  return useQuery({
    // The signed-in user belongs in the key: otherwise the pre-login empty
    // result is cached for five minutes and the merchant dropdown looks empty
    // after a fresh login or an account switch.
    queryKey: ['loan-connected-merchants', uid],
    enabled: !!uid,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<{ name: string; relationshipId: string }[]> => {
      if (!uid) return [];
      const { data: me } = await supabase.from('merchant_profiles').select('merchant_id').eq('user_id', uid).maybeSingle();
      const myId = (me as { merchant_id?: string } | null)?.merchant_id;
      if (!myId) return [];
      const { data: rels } = await supabase
        .from('merchant_relationships')
        .select('id, merchant_a_id, merchant_b_id, status')
        .or(`merchant_a_id.eq.${myId},merchant_b_id.eq.${myId}`);
      const active = ((rels || []) as { id?: string; merchant_a_id: string; merchant_b_id: string; status: string }[])
        .filter((r) => r.status === 'active' && r.id)
        .map((r) => ({ relationshipId: r.id as string, merchantId: r.merchant_a_id === myId ? r.merchant_b_id : r.merchant_a_id }));
      if (!active.length) return [];
      const { data: profiles } = await supabase.from('merchant_profiles').select('merchant_id, display_name').in('merchant_id', active.map((a) => a.merchantId));
      const names = new Map(((profiles || []) as { merchant_id: string; display_name?: string | null }[]).map((p) => [p.merchant_id, (p.display_name || '').trim()]));
      return active
        .map((a) => ({ name: names.get(a.merchantId) || '', relationshipId: a.relationshipId }))
        .filter((a) => a.name);
    },
  });
}

/**
 * Names offered when picking the merchant of a loan move: merchants with
 * loan history first (with their balance), then connected merchants, then
 * suppliers — de-duplicated case-insensitively so one merchant is never
 * offered under two spellings.
 */
export function useLoanMerchantNames(state: TrackerState): LoanMerchantOption[] {
  const { data: connected } = useConnectedMerchantNames();
  return useMemo(() => {
    const out = new Map<string, LoanMerchantOption>();
    const add = (name: string, opt: Omit<LoanMerchantOption, 'name'>) => {
      const clean = name.trim().replace(/\s+/g, ' ');
      if (!clean) return;
      const key = clean.toLowerCase();
      const existing = out.get(key);
      if (existing) {
        existing.connected = existing.connected || opt.connected;
        existing.relationshipId = existing.relationshipId ?? opt.relationshipId;
        return;
      }
      out.set(key, { name: clean, ...opt });
    };
    for (const st of buildMerchantStatements(state.usdtTransfers)) add(st.name, { net: st.net, connected: false });
    for (const c of connected || []) add(c.name, { connected: true, relationshipId: c.relationshipId });
    for (const s of state.suppliers || []) add(s.name, { connected: false });
    return Array.from(out.values());
  }, [state.usdtTransfers, state.suppliers, connected]);
}
