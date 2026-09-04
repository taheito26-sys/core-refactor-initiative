import { supabase } from '@/integrations/supabase/client';
import type { ExchangeId } from './types';

export async function connectExchange(params: {
  exchange: ExchangeId;
  apiKey: string;
  apiSecret: string;
  passphrase?: string;
  label?: string;
}) {
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user) throw new Error('Not signed in');

  const { error } = await supabase.from('exchange_credentials' as any).upsert(
    {
      user_id: userData.user.id,
      exchange: params.exchange,
      api_key: params.apiKey,
      api_secret: params.apiSecret,
      passphrase: params.passphrase || null,
      label: params.label || null,
    },
    { onConflict: 'user_id,exchange' },
  );
  if (error) throw error;
}

export async function disconnectExchange(exchange: ExchangeId) {
  const { error } = await supabase.from('exchange_credentials' as any).delete().eq('exchange', exchange);
  if (error) throw error;
}

export async function syncExchange(
  exchange: ExchangeId,
  action: 'balances' | 'p2p-orders' | 'all' = 'all',
  /**
   * Explicit P2P history window (Binance only). Omit for the normal rolling
   * trailing-90-days sync; pass a specific month's bounds to pull orders
   * older than that window in on demand -- see useExchangeMonthSync.
   */
  range?: { startTimestamp: number; endTimestamp: number },
) {
  const { data, error } = await supabase.functions.invoke('exchange-sync', {
    body: { exchange, action, ...range },
  });
  if (error) {
    // supabase-js only gives a generic "non-2xx status code" message here;
    // the actual error body is on error.context (the raw Response).
    const context = (error as { context?: Response }).context;
    if (context) {
      try {
        const body = await context.clone().json();
        if (body?.error) throw new Error(body.error);
      } catch {
        // fall through to the generic error below
      }
    }
    throw error;
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function markTransfersLinked(
  links: { transferId: string; entityType: 'batch' | 'trade'; entityId: string }[],
) {
  await Promise.all(
    links.map(async ({ transferId, entityType, entityId }) => {
      const { error } = await supabase
        .from('exchange_transfers' as any)
        .update({
          linked_entity_type: entityType,
          linked_entity_id: entityId,
          linked_at: new Date().toISOString(),
        })
        .eq('id', transferId);
      if (error) throw error;
    }),
  );
}

export async function markOrdersLinked(
  links: { orderId: string; entityType: 'batch' | 'trade'; entityId: string }[],
) {
  await Promise.all(links.map((l) => markOrderLinked(l.orderId, l.entityType, l.entityId)));
}

export async function markOrderLinked(orderId: string, entityType: 'batch' | 'trade', entityId: string) {
  const { error } = await supabase
    .from('exchange_p2p_orders' as any)
    .update({ linked_entity_type: entityType, linked_entity_id: entityId, linked_at: new Date().toISOString() })
    .eq('id', orderId);
  if (error) throw error;
}

/** Marks a Pay/network transfer as "not an order" (e.g. a loan repayment received via Pay) so it stops showing in the exchange inbox without ever being imported as a batch/trade. */
export async function dismissTransfer(transferId: string) {
  const { error } = await supabase
    .from('exchange_transfers' as any)
    .update({ dismissed_at: new Date().toISOString() })
    .eq('id', transferId);
  if (error) throw error;
}
