import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startAppUpdates } from '@/lib/app-updates';

const { notify, completed, dismiss, waitSaves, hasSaves } = vi.hoisted(() => ({
  notify: vi.fn(), completed: vi.fn(), dismiss: vi.fn(), waitSaves: vi.fn(), hasSaves: vi.fn(),
}));
vi.mock('@/features/app-updates/update-notice', () => ({ showAppUpdate: notify, showAppUpdated: completed, dismissAppUpdate: dismiss }));
vi.mock('@/lib/app-update-saves', () => ({ waitForAppSaves: waitSaves, hasPendingAppSaves: hasSaves }));
let stop: (() => void) | undefined;
const version = (buildId: string) => ({ ok: true, json: async () => ({ buildId }) }) as Response;
const tick = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); sessionStorage.clear(); document.body.innerHTML = '';
  waitSaves.mockResolvedValue(undefined); hasSaves.mockReturnValue(false);
  vi.stubGlobal('fetch', vi.fn(async () => version('new')));
});
afterEach(() => { stop?.(); vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('automatic app launch updates', () => {
  it('automatically escapes the cached shell through the network-only recovery page after saves', async () => {
    const replace = vi.fn();
    vi.stubGlobal('location', { origin: 'https://tracker.test', pathname: '/trading/orders', search: '?month=2026-11', hash: '#orders', replace });
    vi.stubGlobal('navigator', {});
    let finish: () => void = () => {};
    waitSaves.mockReturnValue(new Promise<void>(resolve => { finish = resolve; }));
    stop = startAppUpdates('old');
    await tick();
    expect(replace).not.toHaveBeenCalled();
    finish(); await tick();
    expect(replace).toHaveBeenCalledWith('https://tracker.test/auth/refresh.html?next=%2Ftrading%2Forders%3Fmonth%3D2026-11%23orders');
  });

  it('starts checking immediately and returns without waiting for the network or delaying rendering', () => {
    vi.mocked(fetch).mockReturnValue(new Promise(() => {}));
    stop = startAppUpdates('old', vi.fn());
    expect(typeof stop).toBe('function');
    expect(fetch).toHaveBeenCalledWith('/app-version.json', expect.objectContaining({ cache: 'no-store', signal: expect.any(AbortSignal) }));
    const screen = document.createElement('main'); document.body.append(screen);
    expect(screen.isConnected).toBe(true);
  });
  it('automatically reloads once without waiting for a button or an open form', async () => {
    const editor = document.createElement('div'); editor.setAttribute('role', 'dialog');
    const input = document.createElement('input'); editor.append(input); document.body.append(editor);
    input.dispatchEvent(new Event('input', { bubbles: true })); input.focus();
    const reload = vi.fn(); stop = startAppUpdates('old', reload);
    await tick();
    expect(notify).toHaveBeenCalledWith('updating');
    expect(reload).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(reload).toHaveBeenCalledTimes(1);
  });
  it('shows completion only after the new build actually loads', async () => {
    const reload = vi.fn(); stop = startAppUpdates('old', reload); await tick();
    expect(completed).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('app-update-from-build')).toBe('old');
    stop(); stop = startAppUpdates('new', reload); await tick();
    expect(completed).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem('app-update-from-build')).toBeNull();
    expect(reload).toHaveBeenCalledTimes(1);
  });
  it('does not claim completion or loop when the old bundle is still served', async () => {
    const reload = vi.fn(); stop = startAppUpdates('old', reload); await tick();
    stop(); stop = startAppUpdates('old', reload); await vi.advanceTimersByTimeAsync(10_000);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(completed).not.toHaveBeenCalled();
  });
  it('does not announce an update when already current', async () => {
    vi.mocked(fetch).mockResolvedValue(version('old'));
    const reload = vi.fn(); stop = startAppUpdates('old', reload); await tick();
    expect(notify).not.toHaveBeenCalled(); expect(reload).not.toHaveBeenCalled();
  });
  it('waits for submitted saves to finish, then automatically restarts', async () => {
    let saved: () => void = () => {};
    waitSaves.mockReturnValue(new Promise<void>(resolve => { saved = resolve; })); hasSaves.mockReturnValue(true);
    const reload = vi.fn(); stop = startAppUpdates('old', reload); await tick();
    expect(reload).not.toHaveBeenCalled(); expect(notify).toHaveBeenCalledWith('saving');
    saved(); await tick();
    expect(reload).toHaveBeenCalledTimes(1);
  });
  it('keeps a failed save open and resumes automatically when saving succeeds', async () => {
    waitSaves.mockRejectedValueOnce(new Error('saving offline'));
    const reload = vi.fn(); stop = startAppUpdates('old', reload); await tick();
    expect(reload).not.toHaveBeenCalled(); expect(notify).toHaveBeenCalledWith('saving');
    await vi.advanceTimersByTimeAsync(5000);
    expect(reload).toHaveBeenCalledTimes(1);
  });
  it('does not reload after the updater stops while a save is in progress', async () => {
    let saved: () => void = () => {};
    waitSaves.mockReturnValue(new Promise<void>(resolve => { saved = resolve; }));
    const reload = vi.fn(); stop = startAppUpdates('old', reload); await tick(); stop(); saved(); await tick();
    expect(reload).not.toHaveBeenCalled();
  });
  it('activates a waiting worker automatically and reloads after activation', async () => {
    const worker = new EventTarget(); const activate = vi.fn();
    const registration = { waiting: { postMessage: activate } as { postMessage: typeof activate } | null, update: vi.fn(async () => {}) };
    Object.assign(worker, { controller: {}, register: vi.fn(async () => registration) }); vi.stubGlobal('navigator', { serviceWorker: worker });
    const reload = vi.fn(); stop = startAppUpdates('old', reload); await tick();
    expect(activate).toHaveBeenCalledWith({ type: 'SKIP_WAITING' }); expect(reload).not.toHaveBeenCalled();
    registration.waiting = null; worker.dispatchEvent(new Event('controllerchange')); await tick();
    expect(reload).toHaveBeenCalledTimes(1);
  });
  it('waits for installation rather than reloading the old bundle', async () => {
    const worker = new EventTarget();
    const registration = { installing: new EventTarget() as EventTarget | null, update: vi.fn(async () => {}) };
    Object.assign(worker, { controller: {}, register: vi.fn(async () => registration) }); vi.stubGlobal('navigator', { serviceWorker: worker });
    const reload = vi.fn(); stop = startAppUpdates('old', reload); await tick();
    expect(reload).not.toHaveBeenCalled(); expect(notify).toHaveBeenCalledWith('updating');
    registration.installing = null; worker.dispatchEvent(new Event('controllerchange')); await tick();
    expect(reload).toHaveBeenCalledTimes(1);
  });
  it('does not reload just because a first installation takes control', async () => {
    const worker = new EventTarget(); Object.assign(worker, { controller: null, register: vi.fn(async () => ({ update: vi.fn(async () => {}) })) });
    vi.stubGlobal('navigator', { serviceWorker: worker }); vi.mocked(fetch).mockResolvedValue(version('old'));
    const reload = vi.fn(); stop = startAppUpdates('old', reload); await tick();
    worker.dispatchEvent(new Event('controllerchange')); await tick(); expect(reload).not.toHaveBeenCalled();
  });
  it('checks again automatically when the app resumes', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(version('old'));
    const reload = vi.fn(); stop = startAppUpdates('old', reload); await tick();
    window.dispatchEvent(new Event('focus')); await tick(); expect(reload).toHaveBeenCalledTimes(1);
  });
  it('keeps opening normally offline and retries without user approval', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'));
    const reload = vi.fn(); stop = startAppUpdates('old', reload); await tick(); expect(reload).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5000); expect(reload).toHaveBeenCalledTimes(1);
  });
  it('recovers from a hung version request', async () => {
    vi.mocked(fetch).mockImplementationOnce((_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));
    const reload = vi.fn(); stop = startAppUpdates('old', reload); await vi.advanceTimersByTimeAsync(10_000);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
