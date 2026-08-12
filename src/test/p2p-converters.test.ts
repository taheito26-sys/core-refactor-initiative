import { describe, expect, it } from 'vitest';
import { buildMerchantStats, buildP2PHistoryPoints, toSnapshot } from '@/features/p2p/utils/converters';

describe('p2p converters', () => {
  it('normalizes camelCase and snake_case snapshot payloads', () => {
    const camel = toSnapshot({
      ts: 1710000000000,
      sellAvg: 3.8,
      buyAvg: 3.7,
      bestSell: 3.81,
      bestBuy: 3.69,
      spread: 0.1,
      spreadPct: 2.63,
      sellDepth: 1200,
      buyDepth: 900,
      sellOffers: [{ price: 3.8, min: 10, max: 100, nick: 'A', methods: [], available: 100, trades: 20, completion: 0.9 }],
      buyOffers: [{ price: 3.7, min: 10, max: 100, nick: 'B', methods: [], available: 100, trades: 20, completion: 0.9 }],
    }, '2024-03-10T10:00:00.000Z');

    expect(camel.sellAvg).toBe(3.8);
    expect(camel.buyAvg).toBe(3.7);
    expect(camel.bestSell).toBe(3.81);
    expect(camel.bestBuy).toBe(3.69);
    expect(camel.sellOffers).toHaveLength(1);
    expect(camel.buyOffers).toHaveLength(1);

    const snake = toSnapshot({
      ts: 1710000000000,
      sell_avg: 3.8,
      buy_avg: 3.7,
      best_sell: 3.81,
      best_buy: 3.69,
      spread: 0.1,
      spread_pct: 2.63,
      sell_depth: 1200,
      buy_depth: 900,
      sell_offers: [{ price: 3.8, min: 10, max: 100, nick: 'A', methods: [], available: 100, trades: 20, completion: 0.9 }],
      buy_offers: [{ price: 3.7, min: 10, max: 100, nick: 'B', methods: [], available: 100, trades: 20, completion: 0.9 }],
    }, '2024-03-10T10:00:00.000Z');

    expect(snake.sellAvg).toBe(3.8);
    expect(snake.buyAvg).toBe(3.7);
    expect(snake.bestSell).toBe(3.81);
    expect(snake.bestBuy).toBe(3.69);
    expect(snake.sellDepth).toBe(1200);
    expect(snake.buyDepth).toBe(900);
    expect(snake.sellOffers[0].nick).toBe('A');
    expect(snake.buyOffers[0].nick).toBe('B');
  });

  it('does not swap sellOffers/buyOffers when a market has a negative spread', () => {
    // Regression test: some markets (e.g. Egypt, where bank-transfer methods
    // like Banque Misr commonly price below mobile-wallet methods) genuinely
    // and persistently have sellAvg below buyAvg. This must never cause
    // sellOffers/buyOffers to be swapped — a prior "isSwapped" heuristic did
    // exactly that, silently moving bank-method offers out of sellOffers and
    // breaking method-specific lookups like the Banque Misr KPI.
    const snapshot = toSnapshot({
      ts: 1710000000000,
      sellAvg: 50.73,
      buyAvg: 50.85,
      bestSell: 50.80,
      bestBuy: 50.77,
      sellOffers: [
        { price: 50.73, min: 10, max: 100, nick: 'BankTrader', methods: ['Banque Misr'], available: 100, trades: 20, completion: 0.9 },
      ],
      buyOffers: [
        { price: 50.85, min: 10, max: 100, nick: 'WalletTrader', methods: ['Vodafone cash'], available: 100, trades: 20, completion: 0.9 },
      ],
    }, '2024-03-10T10:00:00.000Z');

    expect(snapshot.sellAvg).toBe(50.73);
    expect(snapshot.buyAvg).toBe(50.85);
    expect(snapshot.sellOffers).toHaveLength(1);
    expect(snapshot.sellOffers[0].nick).toBe('BankTrader');
    expect(snapshot.sellOffers[0].methods).toContain('Banque Misr');
    expect(snapshot.buyOffers[0].nick).toBe('WalletTrader');
  });

  it('builds history points from normalized snapshots', () => {
    const points = buildP2PHistoryPoints([
      {
        fetched_at: '2024-03-10T10:00:00.000Z',
        data: { ts: 1710064800000, sellAvg: 3.8, buyAvg: 3.7, bestSell: 3.81, bestBuy: 3.69, spread: 0.1, spreadPct: 2.63 },
      },
      {
        fetched_at: '2024-03-10T10:05:00.000Z',
        data: { ts: 1710065100000, sell_avg: 3.82, buy_avg: 3.72, best_sell: 3.83, best_buy: 3.71, spread: 0.1, spread_pct: 2.69 },
      },
    ]);

    expect(points).toHaveLength(2);
    expect(points[0].sellAvg).toBe(3.8);
    expect(points[1].buyAvg).toBe(3.72);
    expect(points[0].bestSell).toBe(3.81);
    expect(points[1].bestBuy).toBe(3.71);
  });

  it('builds merchant stats from normalized snapshots', () => {
    const stats = buildMerchantStats([
      {
        fetched_at: '2024-03-10T10:00:00.000Z',
        data: {
          ts: 1710064800000,
          sellAvg: 3.8,
          buyAvg: 3.7,
          sellOffers: [
            { price: 3.8, min: 10, max: 100, nick: 'Alpha', methods: [], available: 60, trades: 20, completion: 0.9 },
          ],
          buyOffers: [
            { price: 3.7, min: 10, max: 100, nick: 'Beta', methods: [], available: 40, trades: 20, completion: 0.9 },
          ],
        },
      },
      {
        fetched_at: '2024-03-10T10:05:00.000Z',
        data: {
          ts: 1710065100000,
          sell_avg: 3.82,
          buy_avg: 3.72,
          sell_offers: [
            { price: 3.82, min: 10, max: 100, nick: 'Alpha', methods: [], available: 80, trades: 20, completion: 0.9 },
          ],
          buy_offers: [],
        },
      },
    ]);

    expect(stats).toHaveLength(2);
    const alpha = stats.find((item) => item.nick === 'Alpha');
    expect(alpha?.appearances).toBe(2);
    expect(alpha?.maxAvailable).toBe(80);
    expect(alpha?.avgAvailable).toBe(70);
  });
});
