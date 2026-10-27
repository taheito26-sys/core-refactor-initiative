import { describe, expect, it } from 'vitest';
import { DEFAULT_OFFER_FILTERS, filterMarketOffers } from './market-view';
import type { P2POffer } from './types';

const offers: P2POffer[] = [
  { nick: 'Alpha', price: 3.7, min: 100, max: 10000, available: 5000, methods: ['Bank'], trades: 800, completion: .99, status: 'online' },
  { nick: 'Beta', price: 3.8, min: 500, max: 5000, available: 800, methods: ['Cash'], trades: 500, completion: .95, status: 'offline' },
  { nick: 'Gamma', price: 3.6, min: 10, max: 0, available: 2000, methods: ['Bank'], trades: 200, completion: .98 },
];

describe('P2P market offer filters', () => {
  it('sorts best price for the selected buying or selling direction without mutating the feed', () => {
    expect(filterMarketOffers(offers, 'buy', DEFAULT_OFFER_FILTERS).map(o => o.nick)).toEqual(['Gamma', 'Alpha', 'Beta']);
    expect(filterMarketOffers(offers, 'sell', DEFAULT_OFFER_FILTERS).map(o => o.nick)).toEqual(['Beta', 'Alpha', 'Gamma']);
    expect(offers[0].nick).toBe('Alpha');
  });
  it('combines merchant search, payment method, completion, and online status', () => {
    const matches = filterMarketOffers(offers, 'buy', { ...DEFAULT_OFFER_FILTERS, search: ' ALP ', method: 'Bank', completion: '.98', online: true });
    expect(matches.map(o => o.nick)).toEqual(['Alpha']);
  });
  it('checks USDT stock and both fiat trade boundaries for the entered amount', () => {
    expect(filterMarketOffers(offers, 'buy', { ...DEFAULT_OFFER_FILTERS, amount: '1000' }).map(o => o.nick)).toEqual(['Gamma', 'Alpha']);
    expect(filterMarketOffers(offers, 'buy', { ...DEFAULT_OFFER_FILTERS, amount: '3000' })).toEqual([]);
    expect(filterMarketOffers(offers, 'buy', { ...DEFAULT_OFFER_FILTERS, amount: '1' })).toEqual([]);
  });
  it('does not imply unknown online status and supports availability/completion sorting', () => {
    expect(filterMarketOffers(offers, 'buy', { ...DEFAULT_OFFER_FILTERS, online: true }).map(o => o.nick)).toEqual(['Alpha']);
    expect(filterMarketOffers(offers, 'buy', { ...DEFAULT_OFFER_FILTERS, sort: 'available' }).map(o => o.nick)).toEqual(['Alpha', 'Gamma', 'Beta']);
    expect(filterMarketOffers(offers, 'buy', { ...DEFAULT_OFFER_FILTERS, sort: 'completion' }).map(o => o.nick)).toEqual(['Alpha', 'Gamma', 'Beta']);
  });
});
