import { supabase } from '@/integrations/supabase/client';
import type { MirrorStatus, Trade } from '@/lib/tracker-helpers';
import { isUuidLike } from './customer-identity';

/*
 * Pushes merchant-recorded trades into the buyer's customer portal
 * (customer_orders) through the mirror_merchant_customer_order RPC. Direct
 * inserts are blocked by RLS for merchants; the RPC is security definer.
 *
 * Idempotent: every row is keyed by source_trade_id = Trade.id, backed by a
 * unique (merchant_id, source_trade_id) index, so a trade can be pushed any
 * number of times and still produces exactly one portal order.
 */

/** pricing_version for a merchant's bulk sync; the notification trigger stays silent for it. */
export const BACKFILL_PRICING_VERSION = 'tracker-sync-backfill';
const LIVE_PRICING_VERSION = 'tracker-sync-v1';

export async function findPortalConnectionId(merchantId: string, customerUserId: string): Promise<string | null> {
  if (!merchantId || !isUuidLike(customerUserId)) return null;
  const { data, error } = await supabase
    .from('customer_merchant_connections')
    .select('id')
    .eq('merchant_id', merchantId)
    .eq('customer_user_id', customerUserId)
    .in('status', ['active', 'pending'])
    .maybeSingle();
  if (error) throw error;
  return data?.id ?? null;
}

export async function mirrorTradeToPortal(params: {
  trade: Pick<Trade, 'id' | 'amountUSDT' | 'sellPriceQAR' | 'note'>;
  connectionId: string;
  baseFiatCurrency: string;
  backfill?: boolean;
}): Promise<void> {
  const { trade, connectionId, baseFiatCurrency, backfill } = params;
  const total = trade.amountUSDT * trade.sellPriceQAR;
  const { error } = await supabase.rpc('mirror_merchant_customer_order', {
    p_connection_id: connectionId,
    p_status: 'completed',
    p_order_type: 'buy',
    p_amount: trade.amountUSDT,
    p_currency: 'USDT',
    p_rate: trade.sellPriceQAR,
    p_total: total,
    p_note: trade.note || null,
    p_send_currency: 'USDT',
    p_receive_currency: baseFiatCurrency,
    p_pricing_mode: 'merchant_quote',
    p_final_rate: trade.sellPriceQAR,
    p_final_total: total,
    p_market_pair: `USDT/${baseFiatCurrency}`,
    p_pricing_version: backfill ? BACKFILL_PRICING_VERSION : LIVE_PRICING_VERSION,
    p_source_trade_id: trade.id,
  // The generated types predate p_source_trade_id (20260909150000).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
  if (error) throw error;
}

/** Resolves the connection and mirrors one trade; never throws. */
export async function syncTradeToPortal(params: {
  trade: Pick<Trade, 'id' | 'amountUSDT' | 'sellPriceQAR' | 'note' | 'voided'>;
  merchantId: string;
  customerUserId: string | null;
  baseFiatCurrency: string;
  backfill?: boolean;
}): Promise<MirrorStatus> {
  const { trade, merchantId, customerUserId, baseFiatCurrency, backfill } = params;
  if (trade.voided || !customerUserId || !isUuidLike(customerUserId)) return 'skipped_not_connected';
  try {
    const connectionId = await findPortalConnectionId(merchantId, customerUserId);
    if (!connectionId) return 'skipped_not_connected';
    await mirrorTradeToPortal({ trade, connectionId, baseFiatCurrency, backfill });
    return 'mirrored';
  } catch (err) {
    console.error('Customer portal sync failed', { tradeId: trade.id, customerUserId, err });
    return 'failed';
  }
}

/** Mirrors every non-voided trade in `trades` to one portal account (one connection lookup). */
export async function syncTradesToPortal(params: {
  trades: Pick<Trade, 'id' | 'amountUSDT' | 'sellPriceQAR' | 'note' | 'voided'>[];
  merchantId: string;
  customerUserId: string;
  baseFiatCurrency: string;
}): Promise<{ statuses: Record<string, MirrorStatus>; mirrored: number; failed: number; connected: boolean }> {
  const { trades, merchantId, customerUserId, baseFiatCurrency } = params;
  const statuses: Record<string, MirrorStatus> = {};
  const connectionId = await findPortalConnectionId(merchantId, customerUserId).catch(() => null);
  if (!connectionId) return { statuses, mirrored: 0, failed: 0, connected: false };
  let mirrored = 0;
  let failed = 0;
  for (const trade of trades) {
    if (trade.voided) continue;
    try {
      await mirrorTradeToPortal({ trade, connectionId, baseFiatCurrency, backfill: true });
      statuses[trade.id] = 'mirrored';
      mirrored += 1;
    } catch (err) {
      console.error('Customer portal backfill failed', { tradeId: trade.id, err });
      statuses[trade.id] = 'failed';
      failed += 1;
    }
  }
  return { statuses, mirrored, failed, connected: true };
}
