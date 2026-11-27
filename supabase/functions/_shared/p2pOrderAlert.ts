/**
 * Pure helpers for the Binance P2P order alert (p2p-order-watch).
 * Kept free of Deno and Supabase imports so Vitest can cover them directly.
 */

/** How often an unacknowledged open order is pushed again. */
export const REMIND_EVERY_MS = 2 * 60 * 1000;
/** A little slack so a 20-second poll that lands just short of 2 minutes still reminds. */
export const REMIND_SLACK_MS = 10 * 1000;
/** How far back the Binance order list is read for open orders. */
export const LOOKBACK_MS = 24 * 60 * 60 * 1000;

/*
 * Binance C2C order status, as text or as the numeric code some responses use:
 * - PENDING (1): waiting for payment
 * - TRADING / BUYER_PAYED (2): paid, waiting for release
 * - IN_APPEAL (3): disputed
 * - DISTRIBUTING (5): releasing
 * - COMPLETED (4), CANCELLED (6), CANCELLED_BY_SYSTEM (7): closed
 */
const OPEN_STATUSES = new Set(['PENDING', 'TRADING', 'BUYER_PAYED', 'BUYER_PAID', 'DISTRIBUTING', 'IN_APPEAL', '1', '2', '3', '5']);

export function isOpenOrderStatus(status: unknown): boolean {
  return OPEN_STATUSES.has(String(status ?? '').trim().toUpperCase());
}

export interface AlertOrder {
  order_number: string;
  side: 'buy' | 'sell';
  asset: string | null;
  fiat: string | null;
  amount: number | null;
  price: number | null;
  total: number | null;
  counterparty: string | null;
  order_status: string;
  order_created_at: string | null;
}

const num = (v: unknown): number | null => {
  const n = parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : null;
};

// deno-lint-ignore no-explicit-any
export function toAlertOrder(raw: any, tradeType: 'BUY' | 'SELL'): AlertOrder | null {
  const orderNumber = raw?.orderNumber != null ? String(raw.orderNumber) : '';
  if (!orderNumber) return null;
  const created = Number(raw.createTime);
  return {
    order_number: orderNumber,
    side: tradeType === 'BUY' ? 'buy' : 'sell',
    asset: raw.asset ?? null,
    fiat: raw.fiat ?? null,
    amount: num(raw.amount),
    price: num(raw.unitPrice ?? raw.price),
    total: num(raw.totalPrice ?? raw.total),
    counterparty: raw.counterPartNickName ?? null,
    order_status: String(raw.orderStatus ?? raw.status ?? ''),
    order_created_at: Number.isFinite(created) && created > 0 ? new Date(created).toISOString() : null,
  };
}

/** Whether an unacknowledged open alert is due another push. */
export function isReminderDue(lastPushedAt: string | null, now: number): boolean {
  if (!lastPushedAt) return true;
  const last = new Date(lastPushedAt).getTime();
  if (!Number.isFinite(last)) return true;
  return now - last >= REMIND_EVERY_MS - REMIND_SLACK_MS;
}

const fmt = (n: number | null, digits: number) =>
  n == null ? '' : n.toLocaleString('en-US', { maximumFractionDigits: digits });

/** Push title and body. Arabic first because the app defaults to Arabic. */
export function alertMessage(order: AlertOrder, pushCount: number): { title: string; body: string } {
  const reminder = pushCount > 0;
  const title = reminder
    ? `⏰ تذكير: طلب P2P مفتوح · Reminder: open P2P order`
    : `🔔 طلب P2P جديد على Binance · New Binance P2P order`;
  const sideAr = order.side === 'buy' ? 'شراء' : 'بيع';
  const sideEn = order.side === 'buy' ? 'BUY' : 'SELL';
  const amount = `${fmt(order.amount, 2)} ${order.asset ?? 'USDT'}`.trim();
  const total = order.total != null ? ` · ${fmt(order.total, 2)} ${order.fiat ?? ''}`.trimEnd() : '';
  const who = order.counterparty ? ` · ${order.counterparty}` : '';
  const body = `${sideAr} / ${sideEn} ${amount}${total}${who}\n#${order.order_number}`;
  return { title, body };
}
