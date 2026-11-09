import { afterEach, expect, it, vi } from 'vitest';
import handler from '../../api/service-health.js';
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const response = () => { const res = { setHeader: vi.fn(), status: vi.fn(), json: vi.fn() }; res.status.mockReturnValue(res); return res; };
it('checks auth and the database without returning records or credentials', async () => {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co'); vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'public-test-key');
  const fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 }); vi.stubGlobal('fetch', fetch);
  const res = response(); await handler({ method: 'GET' }, res);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls[1][0]).toBe('https://example.supabase.co/rest/v1/profiles?select=id&limit=0');
  expect(res.status).toHaveBeenCalledWith(200);
  expect(JSON.stringify(res.json.mock.calls)).not.toContain('public-test-key');
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true, authentication: expect.objectContaining({ status: 200 }), database: expect.objectContaining({ status: 200 }) }));
});
it('reports database outages with a status/code and no raw error body', async () => {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co'); vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'public-test-key');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: true, status: 200 }).mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({ code: 'PGRST002', message: 'private diagnostic details' }) }));
  const res = response(); await handler({ method: 'GET' }, res);
  expect(res.status).toHaveBeenCalledWith(503);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: false, database: expect.objectContaining({ code: 'PGRST002' }) }));
  expect(JSON.stringify(res.json.mock.calls)).not.toContain('private diagnostic details');
});
it('does not permit write methods', async () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch); const res = response(); await handler({ method: 'POST' }, res);
  expect(res.status).toHaveBeenCalledWith(405); expect(fetch).not.toHaveBeenCalled();
});
it('checks the same public configuration embedded in the deployed browser build', async () => {
  vi.stubEnv('VITE_SUPABASE_URL', ''); vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', '');
  const key = 'eyJhbGciOiJIUzI1NiJ9.' + btoa(JSON.stringify({ role: 'anon', ref: 'example' })).replace(/=/g, '') + '.publicsignature';
  const fetch = vi.fn().mockResolvedValueOnce({ ok: true, text: async () => '<script type="module" src="/assets/index-test.js"></script>' }).mockResolvedValueOnce({ ok: true, text: async () => `const url="https://example.supabase.co",key="${key}";` }).mockResolvedValue({ ok: true, status: 200 });
  vi.stubGlobal('fetch', fetch); const res = response(); await handler({ method: 'GET' }, res);
  expect(res.status).toHaveBeenCalledWith(200);
  expect(fetch.mock.calls[2][0]).toBe('https://example.supabase.co/auth/v1/health');
  expect(JSON.stringify(res.json.mock.calls)).not.toContain(key);
});
