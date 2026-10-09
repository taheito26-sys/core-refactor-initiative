import { sumLinkedAmount, type ExchangeOrderLink } from './hooks/useExchangeOrderLinks';
import { isCompletedP2POrder, type ExchangeP2POrder } from './types';

/** Amounts within this margin are rounding noise from the exchange. */
const AMOUNT_EPSILON = 0.01;

export type P2PAuditStatus = 'registered' | 'partial' | 'missing' | 'resolved';

export interface P2PAuditRow {
  order: ExchangeP2POrder;
  status: P2PAuditStatus;
  ts: number;
  /** USDT of the order already in the tracker. */
  registeredUSDT: number;
  /** USDT of the order still not in the tracker (0 once registered or resolved). */
  missingUSDT: number;
}

export interface P2PAudit {
  rows: P2PAuditRow[];
  total: number;
  registered: number;
  partial: number;
  missing: number;
  resolved: number;
  missingUSDT: number;
}

/** Local "YYYY-MM" of a timestamp, the same bucketing the order month pills use. */
export function localMonthOf(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Compares the completed P2P orders the exchange reports for a month with
 * what the tracker holds. Only completed USDT orders are considered; cancelled,
 * pending and failed ones never moved money. An order counts as registered by
 * the same rules the exchange inbox uses, so the two never disagree: split
 * links to live entities, a legacy single link, or its order number found in
 * a live trade/batch note. Orders the merchant dismissed on purpose are
 * listed as resolved, not as missing.
 */
export function auditCompletedP2POrders(input: {
  orders: ExchangeP2POrder[] | undefined;
  linksByOrder: Map<string, ExchangeOrderLink[]> | undefined;
  liveEntityIds: Set<string>;
  importedReferences: Set<string>;
  /** "YYYY-MM", or "all" for every month. */
  monthKey: string;
}): P2PAudit {
  const rows: P2PAuditRow[] = [];
  for (const o of input.orders || []) {
    if (String(o.asset || '').toUpperCase() !== 'USDT') continue;
    if (!isCompletedP2POrder(o.status)) continue;
    const ts = o.order_time ? new Date(o.order_time).getTime() : 0;
    if (input.monthKey !== 'all' && (!ts || localMonthOf(ts) !== input.monthKey)) continue;

    const amount = Number(o.amount) || 0;
    const links = (input.linksByOrder?.get(o.id) ?? []).filter(l => input.liveEntityIds.has(l.entity_id));
    let registeredUSDT = sumLinkedAmount(links);
    if (registeredUSDT <= AMOUNT_EPSILON) {
      const legacyLinked = !!o.linked_at && !!o.linked_entity_id && input.liveEntityIds.has(o.linked_entity_id);
      if (legacyLinked || input.importedReferences.has(o.order_number)) registeredUSDT = amount;
    }
    const missingUSDT = Math.max(0, amount - registeredUSDT);

    let status: P2PAuditStatus;
    if (missingUSDT <= AMOUNT_EPSILON) status = 'registered';
    else if (o.dismissed_at) status = 'resolved';
    else status = registeredUSDT > AMOUNT_EPSILON ? 'partial' : 'missing';

    rows.push({
      order: o,
      status,
      ts,
      registeredUSDT: Math.min(registeredUSDT, amount),
      missingUSDT: status === 'resolved' || status === 'registered' ? 0 : missingUSDT,
    });
  }
  rows.sort((a, b) => b.ts - a.ts);
  const count = (s: P2PAuditStatus) => rows.filter(r => r.status === s).length;
  return {
    rows,
    total: rows.length,
    registered: count('registered'),
    partial: count('partial'),
    missing: count('missing'),
    resolved: count('resolved'),
    missingUSDT: rows.reduce((sum, r) => sum + r.missingUSDT, 0),
  };
}
