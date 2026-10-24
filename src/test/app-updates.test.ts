import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startAppUpdates } from '@/lib/app-updates';
const notify = vi.hoisted(() => vi.fn());
vi.mock('sonner', () => ({ toast: { info: notify } }));
let stop: (() => void) | undefined;
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); sessionStorage.clear();
  history.replaceState({}, '', '/orders');
  document.body.innerHTML = '';
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ buildId: 'new' }) })));
});
afterEach(() => { stop?.(); vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('automatic app updates', () => {
  it('automatically reloads a clean app when a new release is available', async () => {
    const reload = vi.fn(); stop = startAppUpdates('old', reload);
    await vi.advanceTimersByTimeAsync(0);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith('/app-version.json', { cache: 'no-store' });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(reload).toHaveBeenCalledTimes(1);
  });
  it('protects an edited page and applies the update after navigation', async () => {
    const reload = vi.fn(); stop = startAppUpdates('old', reload);
    const input = document.createElement('input'); document.body.append(input);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(0);
    expect(reload).not.toHaveBeenCalled(); expect(notify).toHaveBeenCalled();
    history.pushState({}, '', '/stock');
    await vi.advanceTimersByTimeAsync(1000);
    expect(reload).toHaveBeenCalledTimes(1);
  });
  it('continues checking an already-open app and tolerates an offline check', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'));
    const reload = vi.fn(); stop = startAppUpdates('old', reload);
    await vi.advanceTimersByTimeAsync(0); expect(reload).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(30_000); expect(reload).toHaveBeenCalledTimes(1);
  });
  it('waits for the replacement worker to activate before reloading', async () => {
    const worker = new EventTarget();
    const registration = { installing: new EventTarget() as EventTarget | null, waiting: null, update: vi.fn(async () => {}) };
    Object.assign(worker, { controller: {}, register: vi.fn(async () => registration) });
    vi.stubGlobal('navigator', { serviceWorker: worker });
    const reload = vi.fn(); stop = startAppUpdates('old', reload);
    await vi.advanceTimersByTimeAsync(0);
    expect(reload).not.toHaveBeenCalled();
    registration.installing = null;
    worker.dispatchEvent(new Event('controllerchange'));
    expect(reload).toHaveBeenCalledTimes(1);
  });
  it('does not reload just because the first service worker takes control', async () => {
    const worker = new EventTarget();
    Object.assign(worker, { controller: null, register: vi.fn(async () => ({ update: vi.fn(async () => {}) })) });
    vi.stubGlobal('navigator', { serviceWorker: worker });
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ buildId: 'old' }) } as Response);
    const reload = vi.fn(); stop = startAppUpdates('old', reload);
    await vi.advanceTimersByTimeAsync(0);
    worker.dispatchEvent(new Event('controllerchange'));
    expect(reload).not.toHaveBeenCalled();
  });

  it('does not enter a reload loop if the server still serves the old bundle', async () => {
    const reload = vi.fn(); stop = startAppUpdates('old', reload);
    await vi.advanceTimersByTimeAsync(0); expect(reload).toHaveBeenCalledTimes(1);
    stop(); stop = startAppUpdates('old', reload);
    await vi.advanceTimersByTimeAsync(30_000); expect(reload).toHaveBeenCalledTimes(1);
  });

  it('keeps a waiting worker inactive until an edited page is left', async () => {
    const worker = new EventTarget(); const activate = vi.fn();
    const registration = { waiting: { postMessage: activate } as { postMessage: typeof activate } | null, update: vi.fn(async () => {}) };
    Object.assign(worker, { controller: {}, register: vi.fn(async () => registration) });
    vi.stubGlobal('navigator', { serviceWorker: worker });
    const reload = vi.fn(); stop = startAppUpdates('old', reload);
    const input = document.createElement('input'); document.body.append(input);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(0);
    expect(activate).not.toHaveBeenCalled(); expect(reload).not.toHaveBeenCalled();
    history.pushState({}, '', '/stock'); await vi.advanceTimersByTimeAsync(1000);
    expect(activate).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    registration.waiting = null; worker.dispatchEvent(new Event('controllerchange'));
    expect(reload).toHaveBeenCalledTimes(1);
  });

});
