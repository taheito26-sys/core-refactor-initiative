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

export async function syncExchange(exchange: ExchangeId, action: 'balances' | 'p2p-orders' | 'all' = 'all') {
  const { data, error } = await supabase.functions.invoke('exchange-sync', {
    body: { exchange, action },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function markOrderLinked(orderId: string, entityType: 'batch' | 'trade', entityId: string) {
  const { error } = await supabase
    .from('exchange_p2p_orders' as any)
    .update({ linked_entity_type: entityType, linked_entity_id: entityId, linked_at: new Date().toISOString() })
    .eq('id', orderId);
  if (error) throw error;
}
