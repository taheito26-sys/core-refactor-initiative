import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hasPendingAppSaves, registerAppUpdateMutationCheck, resetAppUpdateSaves, trackAppSave, waitForAppSaves } from '@/lib/app-update-saves';
beforeEach(resetAppUpdateSaves);

describe('automatic update save protection', () => {
  it('waits for submitted client portal mutations without blocking on read queries', async () => {
    vi.useFakeTimers();
    let mutations = 1;
    registerAppUpdateMutationCheck(() => mutations);
    try {
      let ready = false;
      const waiting = waitForAppSaves().then(() => { ready = true; });
      expect(hasPendingAppSaves()).toBe(true);
      await vi.advanceTimersByTimeAsync(100);
      expect(ready).toBe(false);
      mutations = 0;
      await vi.advanceTimersByTimeAsync(50);
      await waiting;
      expect(ready).toBe(true);
    } finally {
      registerAppUpdateMutationCheck(() => 0);
      vi.useRealTimers();
    }
  });
  it('waits for submitted tracker and cash writes to complete', async () => {
    let trackerDone: () => void = () => {}, cashDone: () => void = () => {};
    trackAppSave(new Promise<void>(resolve => { trackerDone = resolve; }), 'tracker');
    trackAppSave(new Promise<void>(resolve => { cashDone = resolve; }), 'cash');
    let ready = false; const pending = waitForAppSaves().then(() => { ready = true; });
    expect(hasPendingAppSaves()).toBe(true); trackerDone(); await Promise.resolve(); expect(ready).toBe(false);
    cashDone(); await pending; expect(hasPendingAppSaves()).toBe(false);
  });
  it('does not let another successful channel hide a failed financial save', async () => {
    await trackAppSave(Promise.reject(new Error('tracker offline')), 'tracker').catch(() => {});
    await trackAppSave(Promise.resolve(), 'cash');
    await expect(waitForAppSaves()).rejects.toThrow('tracker offline');
    await trackAppSave(Promise.resolve(), 'tracker');
    await expect(waitForAppSaves()).resolves.toBeUndefined();
  });
  it('does not carry old account failures into the next session', async () => {
    let fail: (reason: Error) => void = () => {};
    const old = trackAppSave(new Promise<void>((_resolve, reject) => { fail = reject; }), 'tracker');
    resetAppUpdateSaves(); fail(new Error('old account')); await old.catch(() => {});
    await expect(waitForAppSaves()).resolves.toBeUndefined();
  });
  it('does not let an older successful save hide a newer failed save', async () => {
    let finishOld: () => void = () => {};
    const old = trackAppSave(new Promise<void>(resolve => { finishOld = resolve; }), 'cash');
    await trackAppSave(Promise.reject(new Error('newer save failed')), 'cash').catch(() => {});
    finishOld(); await old;
    await expect(waitForAppSaves()).rejects.toThrow('newer save failed');
  });

  it('retries the actual failed write before allowing an update', async () => {
    const retry = vi.fn().mockResolvedValue(undefined);
    await trackAppSave(Promise.reject(new Error('offline')), 'tracker', retry).catch(() => {});
    await waitForAppSaves();
    expect(retry).toHaveBeenCalledTimes(1);
    expect(hasPendingAppSaves()).toBe(false);
  });
  it('retains a repeated failure and retries it again on the next check', async () => {
    const retry = vi.fn().mockRejectedValueOnce(new Error('still offline')).mockResolvedValue(undefined);
    await trackAppSave(Promise.reject(new Error('offline')), 'cash', retry).catch(() => {});
    await expect(waitForAppSaves()).rejects.toThrow('still offline');
    await waitForAppSaves();
    expect(retry).toHaveBeenCalledTimes(2);
  });
  it('never retries an obsolete failure after a newer snapshot succeeds', async () => {
    const retry = vi.fn();
    await trackAppSave(Promise.reject(new Error('old failed')), 'tracker', retry).catch(() => {});
    await trackAppSave(Promise.resolve(), 'tracker');
    await waitForAppSaves();
    expect(retry).not.toHaveBeenCalled();
  });

});
