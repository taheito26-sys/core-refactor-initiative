// Google Apps Script Cloud Backup — Ring 2
// Auto-authenticates using the user's existing session credentials.

const GAS_CFG_KEY = 'taheito_gas_cfg';
const GAS_SESSION_KEY = 'taheito_gas_session';

interface GasCfg {
  url: string;
  lastSync: number;
  ver: string;
}

interface GasSession {
  email: string;
  token: string;
  name?: string;
}

export interface CloudAuthResult {
  ok: boolean;
  reason?: string;
}

const _BUILTIN_GAS_URL = 'https://script.google.com/macros/s/AKfycbyhMi7Eg2ww94tidtIhHEwjaKPsoYK-jsVGHPWIsMu-XUjgZgLuffP5_5Ka90DBrqguOw/exec';
let _gasUrl = _BUILTIN_GAS_URL;
let _gasLastSync = 0;
let _gasSession: GasSession | null = null;

export function gasLoadConfig(): void {
  try {
    const raw = localStorage.getItem(GAS_CFG_KEY) || '';
    let cfg: Partial<GasCfg> = {};
    try { cfg = JSON.parse(raw || '{}'); } catch { cfg = {}; }
    _gasUrl = _BUILTIN_GAS_URL;
    _gasLastSync = (cfg && cfg.lastSync) ? cfg.lastSync : 0;
    localStorage.setItem(GAS_CFG_KEY, JSON.stringify({ url: _gasUrl, lastSync: _gasLastSync, ver: 'v2026-03-01' }));
  } catch {}
  // Load session
  try {
    const sessRaw = localStorage.getItem(GAS_SESSION_KEY);
    if (sessRaw) {
      const sess = JSON.parse(sessRaw);
      if (sess && sess.email && sess.token) _gasSession = sess;
    }
  } catch {}
}

export function gasSaveConfig(): void {
  try {
    localStorage.setItem(GAS_CFG_KEY, JSON.stringify({
      url: _gasUrl, lastSync: _gasLastSync, ver: 'v2026-03-01'
    }));
  } catch {}
}

export function getGasUrl(): string { return _gasUrl; }
export function setGasUrl(url: string): void { _gasUrl = url; }
export function getGasLastSync(): number { return _gasLastSync; }
export function setGasLastSync(ts: number): void { _gasLastSync = ts; }

// ── Session management ──
export function getGasSession(): GasSession | null { return _gasSession; }
export function isCloudLoggedIn(): boolean { return !!(_gasSession && _gasSession.email && _gasSession.token); }

function saveSession(email: string, token: string, name?: string): void {
  _gasSession = { email, token, name };
  try { localStorage.setItem(GAS_SESSION_KEY, JSON.stringify(_gasSession)); } catch {}
}

export function clearCloudSession(): void {
  _gasSession = null;
  try { localStorage.removeItem(GAS_SESSION_KEY); } catch {}
}

function safeJsonParse(txt: string): any {
  try { return JSON.parse(txt); } catch { return null; }
}

export async function rawGasPost(payloadObj: Record<string, unknown>): Promise<any> {
  if (!_gasUrl) throw new Error('Cloud URL missing.');
  const resp = await fetch(_gasUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payloadObj || {}),
  });
  const text = await resp.text();
  const asJson = safeJsonParse(text);
  if (!resp.ok) {
    const msg = (asJson && (asJson.error || asJson.message))
      ? (asJson.error || asJson.message)
      : `HTTP ${resp.status} · ${String(text || '').slice(0, 180)}`;
    throw new Error(msg);
  }
  if (!asJson) {
    const head = String(text || '').slice(0, 220);
    throw new Error('Backend did not return JSON. Raw: ' + head);
  }
  return asJson;
}

/** Auto-inject email+token into all authenticated calls */
export async function gasPost(payloadObj: Record<string, unknown>): Promise<any> {
  gasLoadConfig();
  const action = String(payloadObj.action || '').toLowerCase();
  // login & register don't need existing session
  if (action !== 'login' && action !== 'register') {
    if (!_gasSession) throw new Error('Not logged in to Cloud. Sign in first.');
    payloadObj = { ...payloadObj, email: _gasSession.email, token: _gasSession.token };
  }
  return rawGasPost(payloadObj);
}

/** Post with explicit credentials (for admin acting on behalf of a user) */
export async function gasPostAs(email: string, token: string, payloadObj: Record<string, unknown>): Promise<any> {
  gasLoadConfig();
  return rawGasPost({ ...payloadObj, email, token });
}

/**
 * Auto-authenticate with GAS using the user's existing app credentials.
 * Tries login first; if it fails, auto-registers then logs in.
 * Uses email as the username and a deterministic password derived from user_id.
 */
export async function autoAuthenticateCloud(email: string, userId: string, displayName?: string): Promise<boolean> {
  const result = await autoAuthenticateCloudWithDetails(email, userId, displayName);
  return result.ok;
}

function buildPasswordCandidates(userId: string): string[] {
  // Keep newest scheme first, then legacy patterns for backward compatibility.
  return [
    `taheito_${userId}_cloud_2026`,
    `taheito_${userId}_cloud`,
    `taheito_${userId}`,
  ];
}

export async function autoAuthenticateCloudWithDetails(
  email: string,
  userId: string,
  displayName?: string,
): Promise<CloudAuthResult> {
  if (!email || !userId) return { ok: false, reason: 'Missing email or user id.' };
  
  // If already logged in with this email, skip
  if (_gasSession && _gasSession.email === email && _gasSession.token) return { ok: true };
  const passwordCandidates = buildPasswordCandidates(userId);
  
  gasLoadConfig();

  // Stored session for another account causes bad state during account switches.
  if (_gasSession && _gasSession.email !== email) clearCloudSession();
  
  // Try login using known password patterns first.
  for (const pw of passwordCandidates) {
    try {
      const res = await rawGasPost({ action: 'login', email, password: pw });
      if (res && res.ok && res.token) {
        saveSession(email, res.token, displayName || res.user?.name);
        return { ok: true };
      }
    } catch {
      // Continue to next candidate.
    }
  }
  
  // Auto-register with current password scheme.
  const currentPassword = passwordCandidates[0];
  try {
    const res = await rawGasPost({
      action: 'register',
      email,
      password: currentPassword,
      name: displayName || email.split('@')[0],
    });
    if (res && res.ok && res.token) {
      saveSession(email, res.token, displayName || res.user?.name);
      return { ok: true };
    }
  } catch (registerError: unknown) {
    // Registration might fail if account exists with different password.
    for (const pw of passwordCandidates) {
      try {
        const res = await rawGasPost({ action: 'login', email, password: pw });
        if (res && res.ok && res.token) {
          saveSession(email, res.token, displayName || res.user?.name);
          return { ok: true };
        }
      } catch {
        // Keep trying all known patterns.
      }
    }
    const reason = registerError instanceof Error
      ? registerError.message
      : 'Cloud authentication failed after login/register attempts.';
    return { ok: false, reason };
  }
  
  return { ok: false, reason: 'Cloud authentication failed: backend did not return a token.' };
}

/** Register a new cloud account */
export async function cloudRegister(email: string, password: string, name?: string): Promise<any> {
  gasLoadConfig();
  const res = await rawGasPost({ action: 'register', email, password, name: name || email.split('@')[0] });
  if (res && res.ok && res.token) {
    saveSession(email, res.token, res.user?.name);
  }
  return res;
}

/** Login to cloud account */
export async function cloudLogin(email: string, password: string): Promise<any> {
  gasLoadConfig();
  const res = await rawGasPost({ action: 'login', email, password });
  if (res && res.ok && res.token) {
    saveSession(email, res.token, res.user?.name);
  }
  return res;
}

export function fmtBytes(b: number): string {
  const n = +b || 0;
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
  return (n / 1024 / 1024 / 1024).toFixed(1) + ' GB';
}

export interface CloudVersion {
  versionId: string;
  exportedAt?: string;
  bytes?: number;
  fileId?: string;
}

export const GAS_SCRIPT_CODE = `// Taheito Cloud Auth + Storage (Apps Script Web App)
// [internal reference only]`;
