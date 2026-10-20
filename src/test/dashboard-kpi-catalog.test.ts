import { describe, expect, it } from 'vitest';
import { dashboardDefaultPinned, defaultPinned, merchantKpiOptions, resolvePinned, togglePinned } from '@/features/dashboard/kpi-catalog';

const jose = { userNo: 'u1', nick: 'Jose', today: 11, soldToday: 11, total: 171, month: 76 };

describe('dashboard KPI catalog', () => {
  it('offers six boxes per followed merchant', () => {
    const o = merchantKpiOptions([jose], 'P2P');
    expect(o.map(x => x.id)).toEqual(['merchant:u1:today', 'merchant:u1:sold', 'merchant:u1:total', 'merchant:u1:month', 'merchant:u1:seen', 'merchant:u1:name']);
    expect(o[0].value).toBe('+11');
  });
  it('defaults to the first merchant daily count and nothing otherwise', () => {
    expect(defaultPinned([jose])).toEqual(['merchant:u1:today']);
    expect(defaultPinned([])).toEqual([]);
  });
  it('drops pinned ids that no longer exist and keeps order', () => {
    const o = merchantKpiOptions([jose], 'P2P');
    expect(resolvePinned(['merchant:u1:total', 'gone', 'merchant:u1:today'], o).map(x => x.id)).toEqual(['merchant:u1:total', 'merchant:u1:today']);
  });
  it('toggles', () => {
    expect(togglePinned(['a'], 'b')).toEqual(['a', 'b']);
    expect(togglePinned(['a', 'b'], 'a')).toEqual(['b']);
  });
});

describe('dashboardDefaultPinned', () => {
  it('starts with the four boxes of the dashboard home, using the first followed merchant for last online', () => {
    const jose = { userNo: 'u1', nick: 'Jose', today: 1, soldToday: 0, total: 1, month: 1 };
    expect(dashboardDefaultPinned([jose])).toEqual(['tracker:newOrders', 'merchant:u1:seen', 'tracker:conversion', 'tracker:activeClients']);
    expect(dashboardDefaultPinned([])).toEqual(['tracker:newOrders', 'tracker:conversion', 'tracker:activeClients']);
  });
});
