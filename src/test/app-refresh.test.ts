import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const html = readFileSync('public/auth/refresh.html', 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
const run = () => new Function(`return ${script?.trim()}`)() as Promise<void>;
beforeEach(() => {
  document.body.innerHTML = '<h1 id="title"></h1><p id="status"></p><button id="retry" hidden></button>';
  localStorage.setItem('saved-trades', 'keep');
  localStorage.setItem('tracker_settings', JSON.stringify({ language: 'en' }));
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ buildId: 'release-123' }) })));
});
afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ''; localStorage.clear(); });
describe('loading the current release outside the cached app shell', () => {
  it('releases only the app root worker, preserves data, and opens the latest calendar', async () => {
    const unregister = vi.fn(async () => true);
    const other = vi.fn(async () => true);
    vi.stubGlobal('navigator', { serviceWorker: { getRegistrations: vi.fn(async () => [
      { scope: 'https://tracker.test/', unregister }, { scope: 'https://tracker.test/other/', unregister: other },
    ]) } });
    const replace = vi.fn(); vi.stubGlobal('location', { origin: 'https://tracker.test', replace });
    await run();
    expect(unregister).toHaveBeenCalledTimes(1);
    expect(other).not.toHaveBeenCalled();
    expect(localStorage.getItem('saved-trades')).toBe('keep');
    expect(replace).toHaveBeenCalledWith('https://tracker.test/trading/calendar?release=release-123');
  });
  it('leaves the worker and data intact when the network is unavailable', async () => {
    const getRegistrations = vi.fn();
    vi.stubGlobal('navigator', { serviceWorker: { getRegistrations } });
    const replace = vi.fn(); vi.stubGlobal('location', { origin: 'https://tracker.test', replace });
    vi.mocked(fetch).mockRejectedValue(new Error('offline'));
    await run();
    expect(getRegistrations).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    expect(document.getElementById('retry')?.hidden).toBe(false);
    expect(localStorage.getItem('saved-trades')).toBe('keep');
  });
  it('supports Arabic and works without an installed worker', async () => {
    localStorage.setItem('tracker_settings', JSON.stringify({ language: 'ar' }));
    vi.stubGlobal('navigator', {});
    const replace = vi.fn(); vi.stubGlobal('location', { origin: 'https://tracker.test', replace });
    await run();
    expect(document.documentElement.dir).toBe('rtl');
    expect(replace).toHaveBeenCalledTimes(1);
  });
});
