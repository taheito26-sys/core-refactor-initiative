/* global process, Buffer */

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


async function readPublicConfiguration() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
  const origin = 'https://qtrp2ptracker.vercel.app';
  const htmlResponse = await fetch(origin, { signal: controller.signal, redirect: 'error' });
  if (!htmlResponse.ok) throw new Error('App unavailable');
  const html = await htmlResponse.text();
  const asset = html.match(/<script[^>]+src="(\/assets\/[a-zA-Z0-9_.-]+\.js)"/);
  if (!asset) throw new Error('Startup asset unavailable');
  const bundleResponse = await fetch(origin + asset[1], { signal: controller.signal, redirect: 'error' });
  if (!bundleResponse.ok) throw new Error('Startup asset unavailable');
  const bundle = await bundleResponse.text();
  const base = bundle.match(/https:\/\/[a-z0-9]+\.supabase\.co/)?.[0];
  let key = bundle.match(/["'](sb_publishable_[a-zA-Z0-9_-]+)["']/)?.[1];
  if (!key) {
    for (const match of bundle.matchAll(/["'](eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+)["']/g)) {
      try {
        const claims = JSON.parse(Buffer.from(match[1].split('.')[1], 'base64url').toString());
        if (claims.role === 'anon' && (!claims.ref || base === `https://${claims.ref}.supabase.co`)) { key = match[1]; break; }
      } catch { /* Only public anonymous credentials are eligible. */ }
    }
  }
  if (!base || !key) throw new Error('Public app configuration unavailable');
  return { base, key };
  } finally { clearTimeout(timer); }
}

/** Read-only service checks; the database request explicitly returns zero rows. */
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ error: 'method_not_allowed' }); }
  let base = process.env.VITE_SUPABASE_URL;
  let key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!base || !key) {
    try { ({ base, key } = await readPublicConfiguration()); }
    catch { return res.status(503).json({ ok: false, reason: 'public_service_configuration_unavailable' }); }
  }
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
