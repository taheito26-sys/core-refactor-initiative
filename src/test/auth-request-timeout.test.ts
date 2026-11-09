import { afterEach, describe, expect, it, vi } from 'vitest';
import { withAuthDeadline } from '@/features/auth/auth-request';
afterEach(() => vi.useRealTimers());
describe('bounded authentication reads', () => {
  it('aborts a stalled read and rejects so another attempt can start', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal;
    const pending = new Promise<never>(() => {});
    const query = Object.assign(pending, { abortSignal: (next: AbortSignal) => { signal = next; return pending; } });
    const expectation = expect(withAuthDeadline(query, 100)).rejects.toThrow('Account loading timed out');
    await vi.advanceTimersByTimeAsync(100);
    await expectation;
    expect(signal.aborted).toBe(true);
    await expect(withAuthDeadline(Promise.resolve('recovered'), 100)).resolves.toBe('recovered');
  });
  it('returns successful reads and clears their timers', async () => {
    vi.useFakeTimers();
    await expect(withAuthDeadline(Promise.resolve({ data: 'profile' }), 100)).resolves.toEqual({ data: 'profile' });
    expect(vi.getTimerCount()).toBe(0);
  });
});
