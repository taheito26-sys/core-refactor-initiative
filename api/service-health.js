/* global process */

async function checkService(url, key) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  const started = Date.now();
  try {
    const response = await fetch(url, { headers: { apikey: key }, signal: controller.signal, redirect: 'error' });
    let code;
    if (!response.ok) {
      try { const body = await response.json(); code = typeof body.code === 'string' ? body.code : undefined; } catch { /* Status alone is sufficient for non-JSON responses. */ }
    }
    return { ok: response.ok, status: response.status, milliseconds: Date.now() - started, ...(code ? { code } : {}) };
  } catch (error) {
    return { ok: false, status: 0, milliseconds: Date.now() - started, reason: error?.name === 'AbortError' ? 'timeout' : 'connection_failed' };
  } finally { clearTimeout(timer); }
}

/** Read-only service checks; the database request explicitly returns zero rows. */
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ error: 'method_not_allowed' }); }
  const base = process.env.VITE_SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!base || !key) return res.status(503).json({ ok: false, reason: 'service_configuration_missing' });
  let origin;
  try { origin = new URL(base); } catch { return res.status(503).json({ ok: false, reason: 'service_configuration_invalid' }); }
  if (origin.protocol !== 'https:' || !origin.hostname.endsWith('.supabase.co')) return res.status(503).json({ ok: false, reason: 'service_configuration_invalid' });
  const [authentication, database] = await Promise.all([
    checkService(`${origin.origin}/auth/v1/health`, key),
    checkService(`${origin.origin}/rest/v1/profiles?select=id&limit=0`, key),
  ]);
  const ok = authentication.ok && database.ok;
  return res.status(ok ? 200 : 503).json({ ok, checkedAt: new Date().toISOString(), authentication, database });
}
