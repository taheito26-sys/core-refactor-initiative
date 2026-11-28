import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/auth-context';

export interface P2POrderWatch {
  user_id: string;
  enabled: boolean;
  last_checked_at: string | null;
  last_ok_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface P2POrderAlert {
  id: string;
  order_number: string;
  side: 'buy' | 'sell' | null;
  asset: string | null;
  fiat: string | null;
  amount: number | null;
  price: number | null;
  total: number | null;
  counterparty: string | null;
  order_status: string | null;
  first_seen_at: string;
  push_count: number;
}

const watchKey = (userId: string | null) => ['p2p-order-watch', userId];
const alertsKey = (userId: string | null) => ['p2p-order-alerts', userId];

/** The merchant's alert switch plus the server's last check result. */
export function useP2POrderWatch() {
  const { userId } = useAuth();
  return useQuery({
    queryKey: watchKey(userId),
    enabled: Boolean(userId),
    refetchInterval: 60_000,
    queryFn: async (): Promise<P2POrderWatch | null> => {
      const { data, error } = await supabase
        .from('p2p_order_watch' as any)
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();
      if (error) throw error;
      return (data as unknown as P2POrderWatch) ?? null;
    },
  });
}

export function useSetP2POrderWatch() {
  const { userId } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (enabled: boolean) => {
      const { error } = await supabase
        .from('p2p_order_watch' as any)
        .upsert({ user_id: userId, enabled } as any, { onConflict: 'user_id' });
      if (error) throw error;
      if (!enabled) return null;
      // Check straight away so a bad or missing Binance key shows up now, not later.
      const { data } = await supabase.functions.invoke('p2p-order-watch', { body: { action: 'check' } });
      return data as { ok: boolean; open: number; error?: string } | null;
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: watchKey(userId) });
      qc.invalidateQueries({ queryKey: alertsKey(userId) });
    },
  });
}

/** Open, unacknowledged Binance orders, kept live through Realtime. */
export function useOpenP2POrderAlerts() {
  const { userId } = useAuth();
  const qc = useQueryClient();

  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`p2p-order-alerts-${userId}-${Math.random().toString(36).slice(2)}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'p2p_order_alerts', filter: `user_id=eq.${userId}` },
        () => qc.invalidateQueries({ queryKey: alertsKey(userId) }),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, qc]);

  return useQuery({
    queryKey: alertsKey(userId),
    enabled: Boolean(userId),
    refetchOnWindowFocus: true,
    // Realtime is the fast path; this makes sure a dropped socket still
    // raises the alert within one server-check interval.
    refetchInterval: 20_000,
    queryFn: async (): Promise<P2POrderAlert[]> => {
      const { data, error } = await supabase
        .from('p2p_order_alerts' as any)
        .select('id, order_number, side, asset, fiat, amount, price, total, counterparty, order_status, first_seen_at, push_count')
        .eq('user_id', userId)
        .is('acknowledged_at', null)
        .is('resolved_at', null)
        .order('first_seen_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as P2POrderAlert[];
    },
  });
}

export function useAcknowledgeP2POrderAlerts() {
  const { userId } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[] | null) => {
      const { error } = await supabase.rpc('acknowledge_p2p_order_alerts' as any, { p_alert_ids: ids } as any);
      if (error) throw error;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: alertsKey(userId) }),
  });
}
