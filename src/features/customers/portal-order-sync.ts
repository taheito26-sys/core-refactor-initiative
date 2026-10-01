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
  trade: Pick<Trade, 'id' | 'amountUSDT' | 'sellPriceQAR'>;
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
    // The trade note is the merchant's own (import references, cost-basis
    // flags) and never goes to the buyer.
    p_note: null,
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
  trade: Pick<Trade, 'id' | 'amountUSDT' | 'sellPriceQAR' | 'voided'>;
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
  trades: Pick<Trade, 'id' | 'amountUSDT' | 'sellPriceQAR' | 'voided'>[];
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

/**
 * What the buyer's portal copy of a trade should currently show. Stored on
 * the trade (mirrorSignature) after each successful sync, so a later edit,
 * void or reassignment is detected by comparison and reconciled once.
 */
export function portalSignature(
  trade: Pick<Trade, 'amountUSDT' | 'sellPriceQAR' | 'voided'>,
  customerUserId: string | null,
): string {
  return [customerUserId || '', trade.amountUSDT, trade.sellPriceQAR, trade.voided ? 1 : 0].join('|');
}

/**
 * What the background sync should do with a trade given its current portal
 * signature:
 *   - none: already in sync, or skipped before signatures existed (old
 *     history is only pushed when the merchant asks)
 *   - reconcile: in a portal already, but edited, voided or reassigned since
 *   - mark_skipped: voided before ever reaching a portal
 *   - sync: not mirrored yet
 */
export function mirrorAction(
  trade: Pick<Trade, 'mirrorStatus' | 'mirrorSignature' | 'voided'>,
  signature: string,
): 'none' | 'reconcile' | 'mark_skipped' | 'sync' {
  if (trade.mirrorStatus && trade.mirrorSignature === signature) return 'none';
  if ((trade.mirrorStatus === 'skipped_not_connected' || trade.mirrorStatus === 'failed') && !trade.mirrorSignature) return 'none';
  if (trade.mirrorStatus === 'mirrored') return 'reconcile';
  if (trade.voided) return 'mark_skipped';
  return 'sync';
}

/** 'deferred': not attempted (no usable connection right now); retry later. */
export type ReconcileResult = 'not_found' | 'unchanged' | 'updated' | 'moved' | 'cancelled' | 'removed' | 'deferred';

/**
 * Brings an already-mirrored portal order in line with its trade: amount and
 * rate after an edit, cancelled after a void, moved or removed after the
 * trade was reassigned to another buyer. Throws on failure.
 */
export async function reconcileTradeInPortal(params: {
  trade: Pick<Trade, 'id' | 'amountUSDT' | 'sellPriceQAR' | 'voided'>;
  merchantId: string;
  customerUserId: string | null;
}): Promise<ReconcileResult> {
  const { trade, merchantId, customerUserId } = params;
  const connectionId = customerUserId ? await findPortalConnectionId(merchantId, customerUserId) : null;
  // Still linked but no usable connection right now: leave the portal row
  // alone. Only a trade with no portal buyer at all may have its row removed.
  if (customerUserId && !connectionId) return 'deferred';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)('reconcile_mirrored_customer_order', {
    p_source_trade_id: trade.id,
    p_connection_id: connectionId,
    p_amount: trade.amountUSDT,
    p_rate: trade.sellPriceQAR,
    p_note: null,
    p_voided: !!trade.voided,
  });
  if (error) throw error;
  return data as ReconcileResult;
}

/** PostgREST's "function does not exist" -- the reconcile migration isn't applied yet. */
export function isMissingFunctionError(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  return e?.code === 'PGRST202' || /could not find the function|does not exist/i.test(e?.message ?? '');
}

/**
 * Makes the buyer's loan statements visible in their portal wallet: the
 * customer-loan-statement edge function only finds loans through a
 * buyer_statement_links row attached to the portal account, one per
 * currency. For each currency the buyer has loans in, an existing link of
 * the same buyer (any record of their identity group) is attached if it is
 * unattached, or a new one is created. A link already attached to a
 * different portal account is left alone.
 */
export async function ensureStatementLinks(params: {
  merchantUserId: string;
  customerId: string;
  customerIdGroup: Iterable<string>;
  customerUserId: string;
  currencies: Iterable<string>;
}): Promise<{ created: number; attached: number }> {
  const { merchantUserId, customerId, customerUserId } = params;
  const groupIds = [...new Set([customerId, ...params.customerIdGroup])];
  const currencies = [...new Set([...params.currencies].filter(Boolean))];
  let created = 0;
  let attached = 0;
  if (!merchantUserId || !isUuidLike(customerUserId) || currencies.length === 0) return { created, attached };

  const { data: links, error } = await supabase
    .from('buyer_statement_links')
    .select('id, customer_id, currency, customer_user_id')
    .eq('user_id', merchantUserId)
    .in('customer_id', groupIds)
    .is('revoked_at', null);
  if (error) throw error;

  for (const currency of currencies) {
    const forCurrency = (links ?? []).filter(l => l.currency === currency);
    if (forCurrency.some(l => l.customer_user_id === customerUserId)) continue;
    const unattached = forCurrency.find(l => !l.customer_user_id);
    if (unattached) {
      const { error: updateError } = await supabase
        .from('buyer_statement_links')
        .update({ customer_user_id: customerUserId })
        .eq('id', unattached.id);
      if (updateError) throw updateError;
      attached += 1;
      continue;
    }
    if (forCurrency.length > 0) continue;
    const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, '');
    const { error: insertError } = await supabase
      .from('buyer_statement_links')
      .insert({ user_id: merchantUserId, customer_id: customerId, token, currency, customer_user_id: customerUserId });
    if (insertError) throw insertError;
    created += 1;
  }
  return { created, attached };
}
