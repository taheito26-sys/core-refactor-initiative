import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { TrackerState } from '@/lib/tracker-helpers';
import { buildMerchantStatements } from '../loan-ledger';

export interface LoanMerchantOption {
  name: string;
  /** Net USDT position: > 0 I owe them, < 0 they owe me; undefined when there is no loan history yet. */
  net?: number;
  connected: boolean;
}

/** Display names of the merchants this merchant has an active relationship with. */
function useConnectedMerchantNames() {
  return useQuery({
    queryKey: ['loan-connected-merchants'],
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<string[]> => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      const { data: me } = await supabase.from('merchant_profiles').select('merchant_id').eq('user_id', user.id).maybeSingle();
      const myId = (me as { merchant_id?: string } | null)?.merchant_id;
      if (!myId) return [];
      const { data: rels } = await supabase
        .from('merchant_relationships')
        .select('merchant_a_id, merchant_b_id, status')
        .or(`merchant_a_id.eq.${myId},merchant_b_id.eq.${myId}`);
      const otherIds = Array.from(new Set(
        ((rels || []) as { merchant_a_id: string; merchant_b_id: string; status: string }[])
          .filter((r) => r.status === 'active')
          .map((r) => (r.merchant_a_id === myId ? r.merchant_b_id : r.merchant_a_id)),
      ));
      if (!otherIds.length) return [];
      const { data: profiles } = await supabase.from('merchant_profiles').select('merchant_id, display_name').in('merchant_id', otherIds);
      return Array.from(new Set(
        ((profiles || []) as { display_name?: string | null }[]).map((p) => (p.display_name || '').trim()).filter(Boolean),
      ));
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
        return;
      }
      out.set(key, { name: clean, ...opt });
    };
    for (const st of buildMerchantStatements(state.usdtTransfers)) add(st.name, { net: st.net, connected: false });
    for (const c of connected || []) add(c, { connected: true });
    for (const s of state.suppliers || []) add(s.name, { connected: false });
    return Array.from(out.values());
  }, [state.usdtTransfers, state.suppliers, connected]);
}
