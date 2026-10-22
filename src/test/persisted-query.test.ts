import { beforeEach, describe, expect, it } from 'vitest';
import { persistedQuery } from '@/lib/persisted-query';

describe('persistedQuery', () => {
  beforeEach(() => localStorage.clear());

  it('has nothing to show on the first visit, then the last answer on the next', async () => {
    const first = persistedQuery('ledger', 'u1', async () => [1, 2, 3]);
    expect(first.initialData()).toBeUndefined();
    expect(await first.queryFn()).toEqual([1, 2, 3]);
    const next = persistedQuery('ledger', 'u1', async () => []);
    expect(next.initialData()).toEqual([1, 2, 3]);
    expect(typeof next.initialDataUpdatedAt()).toBe('number');
  });

  it('keeps one account separate from another and ignores a missing user', async () => {
    await persistedQuery('ledger', 'u1', async () => ['a']).queryFn();
    expect(persistedQuery('ledger', 'u2', async () => []).initialData()).toBeUndefined();
    expect(persistedQuery('ledger', null, async () => []).initialData()).toBeUndefined();
  });

  it('stores an empty answer too, so an empty list opens instantly', async () => {
    await persistedQuery('notes', 'u1', async () => []).queryFn();
    expect(persistedQuery('notes', 'u1', async () => [1]).initialData()).toEqual([]);
  });
});
