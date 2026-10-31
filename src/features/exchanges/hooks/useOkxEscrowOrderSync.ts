import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/auth-context';
import { deriveOkxEscrowOrders } from '../normalize-transfers';
import type { ExchangeTransfer } from '../types';

/**
 * Turns OKX P2P escrow bills into P2P order rows so an OKX sale gets the same
 * order card as a Binance one. Existing orders are never overwritten (the
 * merchant's price, fiat and customer live on them); an order whose escrow was
 * later refunded is marked cancelled so it drops out of the inbox.
 */
export function useOkxEscrowOrderSync() {
  const { userId } = useAuth();
  const qc = useQueryClient();
  const lastSignature = useRef('');

  const { data: bills } = useQuery({
    queryKey: ['exchange-transfers', 'okx-raw'],
    enabled: !!userId,
    queryFn: async (): Promise<ExchangeTransfer[]> => {
      const { data, error } = await supabase
        .from('exchange_transfers' as never)
        .select('*')
        .eq('exchange', 'okx')
        .eq('kind', 'pay');
      if (error) throw error;
      return (data ?? []) as unknown as ExchangeTransfer[];
    },
  });

  useEffect(() => {
    if (!userId || !bills) return;
    const { orders, cancelledOrderNumbers } = deriveOkxEscrowOrders(bills);
    const signature = orders.map((o) => `${o.order_number}:${o.status}:${o.linked_at ?? ''}`).join('|');
    if (orders.length === 0 || signature === lastSignature.current) return;
    lastSignature.current = signature;

    void (async () => {
      const table = () => supabase.from('exchange_p2p_orders' as never);
      const { error } = await table().upsert(
        orders.map((o) => ({ ...o, user_id: userId, exchange: 'okx' })) as never,
        { onConflict: 'user_id,exchange,order_number', ignoreDuplicates: true },
      );
      if (error) {
        lastSignature.current = '';
        return;
      }
      if (cancelledOrderNumbers.length > 0) {
        await table()
          .update({ status: 'cancelled' } as never)
          .eq('exchange', 'okx')
          .in('order_number', cancelledOrderNumbers)
          .is('linked_at', null)
          .neq('status', 'cancelled');
      }
      qc.invalidateQueries({ queryKey: ['exchange-p2p-orders'] });
    })();
  }, [userId, bills, qc]);
}
