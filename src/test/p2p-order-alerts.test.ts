import { describe, expect, it } from 'vitest';
import {
  alertMessage,
  isOpenOrderStatus,
  isReminderDue,
  toAlertOrder,
} from '../../supabase/functions/_shared/p2pOrderAlert.ts';
import { p2pWatchHealth } from '@/features/exchanges/p2p-order-alerts';

describe('Binance P2P order status', () => {
  it('treats waiting, paid, releasing and disputed orders as open', () => {
    for (const s of ['PENDING', 'TRADING', 'BUYER_PAYED', 'DISTRIBUTING', 'IN_APPEAL', 1, 2, 3, 5, 'trading']) {
      expect(isOpenOrderStatus(s)).toBe(true);
    }
  });

  it('treats finished and cancelled orders as closed', () => {
    for (const s of ['COMPLETED', 'CANCELLED', 'CANCELLED_BY_SYSTEM', 4, 6, 7, '', null, undefined]) {
      expect(isOpenOrderStatus(s)).toBe(false);
    }
  });
});

describe('toAlertOrder', () => {
  it('maps a Binance history row', () => {
    const order = toAlertOrder({
      orderNumber: '22812345678901234',
      asset: 'USDT', fiat: 'EGP', amount: '500.00', unitPrice: '50.5', totalPrice: '25250',
      orderStatus: 'TRADING', counterPartNickName: 'Ahmed', createTime: 1764240000000,
    }, 'SELL');
    expect(order).toEqual({
      order_number: '22812345678901234', side: 'sell', asset: 'USDT', fiat: 'EGP',
      amount: 500, price: 50.5, total: 25250, counterparty: 'Ahmed', order_status: 'TRADING',
      order_created_at: new Date(1764240000000).toISOString(),
    });
  });

  it('skips a row without an order number', () => {
    expect(toAlertOrder({ orderStatus: 'TRADING' }, 'BUY')).toBeNull();
  });
});

describe('reminder timing', () => {
  const now = Date.parse('2026-11-27T12:00:00Z');
  it('pushes a never-pushed alert at once', () => {
    expect(isReminderDue(null, now)).toBe(true);
  });
  it('waits about 2 minutes between pushes', () => {
    expect(isReminderDue(new Date(now - 60_000).toISOString(), now)).toBe(false);
    expect(isReminderDue(new Date(now - 100_000).toISOString(), now)).toBe(false);
    // A 20-second poll landing at 1m50s still counts as the 2-minute reminder.
    expect(isReminderDue(new Date(now - 110_000).toISOString(), now)).toBe(true);
    expect(isReminderDue(new Date(now - 130_000).toISOString(), now)).toBe(true);
  });
});

describe('alertMessage', () => {
  const order = toAlertOrder({ orderNumber: '123', asset: 'USDT', fiat: 'QAR', amount: '1000', totalPrice: '3650', orderStatus: 'PENDING', counterPartNickName: 'Sara' }, 'BUY')!;
  it('announces a new order with its side, amount, total and counterparty', () => {
    const { title, body } = alertMessage(order, 0);
    expect(title).toContain('New Binance P2P order');
    expect(body).toContain('BUY 1,000 USDT');
    expect(body).toContain('3,650 QAR');
    expect(body).toContain('Sara');
    expect(body).toContain('#123');
  });
  it('labels later pushes as reminders', () => {
    expect(alertMessage(order, 2).title).toContain('Reminder');
  });
});

describe('p2pWatchHealth', () => {
  const now = Date.parse('2026-11-27T12:00:00Z');
  const base = { enabled: true, last_ok_at: null, last_error: null, updated_at: new Date(now - 30_000).toISOString() };
  it('is off when the switch is off', () => {
    expect(p2pWatchHealth({ ...base, enabled: false }, now)).toBe('off');
    expect(p2pWatchHealth(null, now)).toBe('off');
  });
  it('is starting before the first check', () => {
    expect(p2pWatchHealth(base, now)).toBe('starting');
  });
  it('is ok after a recent check', () => {
    expect(p2pWatchHealth({ ...base, last_ok_at: new Date(now - 20_000).toISOString() }, now)).toBe('ok');
  });
  it('reports an error from the last check', () => {
    expect(p2pWatchHealth({ ...base, last_error: 'Binance 401' }, now)).toBe('error');
  });
  it('is stale when no check has worked for 5 minutes', () => {
    expect(p2pWatchHealth({ ...base, last_ok_at: new Date(now - 6 * 60_000).toISOString() }, now)).toBe('stale');
    expect(p2pWatchHealth({ ...base, updated_at: new Date(now - 6 * 60_000).toISOString() }, now)).toBe('stale');
  });
});
