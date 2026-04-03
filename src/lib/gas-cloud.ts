// Google Apps Script Cloud Backup — Ring 2
// Faithfully ported from the original TRACKER_CLOUDFLARE- source repo.

const GAS_CFG_KEY = 'taheito_gas_cfg';

interface GasCfg {
  url: string;
  lastSync: number;
  ver: string;
}

let _gasUrl = '';
let _gasLastSync = 0;

export function gasLoadConfig(): void {
  try {
    const raw = localStorage.getItem(GAS_CFG_KEY) || '';
    let cfg: Partial<GasCfg> = {};
    try { cfg = JSON.parse(raw || '{}'); } catch { cfg = {}; }
    if (!cfg || cfg.ver !== 'v2026-03-01') {
      if (cfg && cfg.url) _gasUrl = String(cfg.url || '').trim() || _gasUrl || '';
      _gasLastSync = (cfg && cfg.lastSync) ? cfg.lastSync : 0;
      localStorage.setItem(GAS_CFG_KEY, JSON.stringify({ url: _gasUrl, lastSync: _gasLastSync, ver: 'v2026-03-01' }));
    } else {
      _gasUrl = (cfg.url ? String(cfg.url).trim() : '') || _gasUrl || '';
      _gasLastSync = cfg.lastSync || 0;
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

function safeJsonParse(txt: string): any {
  try { return JSON.parse(txt); } catch { return null; }
}

export async function gasPost(payloadObj: Record<string, unknown>): Promise<any> {
  gasLoadConfig();
  if (!_gasUrl) throw new Error('Cloud URL missing. Paste it in Cloud Backup Setup.');
  const resp = await fetch(_gasUrl, {
    method: 'POST',
    // IMPORTANT: text/plain avoids CORS preflight that Apps Script cannot handle
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
    throw new Error('Backend did not return JSON. Check Apps Script deployment access. Raw: ' + head);
  }
  return asJson;
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

// Apps Script code to display in setup
export const GAS_SCRIPT_CODE = `// Taheito Cloud Auth + Storage (Apps Script Web App)
// Actions: register, login, backup, restore
// Deploy as Web App:
// - Execute as: Me
// - Who has access: Anyone

const DB_FILENAME = "taheito-cloud-db.json";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

function doGet(e) {
  return jsonOut_({ ok: true, service: "taheito-cloud", ts: new Date().toISOString() });
}

function doPost(e) {
  let body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || "{}"); }
  catch (err) { return jsonOut_({ ok: false, error: "Invalid JSON" }); }

  const action = String(body.action || "").toLowerCase();
  if (!action) return jsonOut_({ ok: false, error: "Missing action" });

  const db = readDb_();
  pruneSessions_(db);

  try {
    if (action === "register") return handleRegister_(db, body);
    if (action === "login") return handleLogin_(db, body);
    if (action === "backup") return handleBackup_(db, body);
    if (action === "restore") return handleRestore_(db, body);
    if (action === "meta") return handleMeta_(db, body);
    if (action === "restoreversion") return handleRestoreVersion_(db, body);
    return jsonOut_({ ok: false, error: "Unknown action" });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function handleRegister_(db, body) {
  const email = normEmail_(body.email);
  const name = String(body.name || "").trim() || email.split("@")[0];
  const password = String(body.password || "");
  if (!email || email.indexOf("@") === -1) return jsonOut_({ ok: false, error: "Invalid email" });
  if (password.length < 6) return jsonOut_({ ok: false, error: "Password too short" });
  if (db.users[email]) return jsonOut_({ ok: false, error: "User already exists" });
  const salt = Utilities.getUuid();
  const pwHash = sha256b64_(salt + ":" + password);
  db.users[email] = { email, name, salt, pwHash, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  db.data[email] = db.data[email] || { state: {}, exportedAt: null };
  const token = newToken_();
  db.sessions[token] = { email, exp: Date.now() + SESSION_TTL_MS };
  writeDb_(db);
  return jsonOut_({ ok: true, token, user: { email, name }, state: db.data[email].state || {}, exportedAt: db.data[email].exportedAt });
}

function handleLogin_(db, body) {
  const email = normEmail_(body.email);
  const password = String(body.password || "");
  if (!email || email.indexOf("@") === -1) return jsonOut_({ ok: false, error: "Invalid email" });
  const u = db.users[email];
  if (!u) return jsonOut_({ ok: false, error: "User not found" });
  if (sha256b64_(u.salt + ":" + password) !== u.pwHash) return jsonOut_({ ok: false, error: "Wrong password" });
  const token = newToken_();
  db.sessions[token] = { email, exp: Date.now() + SESSION_TTL_MS };
  u.updatedAt = new Date().toISOString();
  db.data[email] = db.data[email] || { state: {}, exportedAt: null };
  writeDb_(db);
  return jsonOut_({ ok: true, token, user: { email, name: u.name || email.split("@")[0] }, state: db.data[email].state || {}, exportedAt: db.data[email].exportedAt });
}

function handleBackup_(db, body) {
  const email = normEmail_(body.email);
  const token = String(body.token || "");
  requireSession_(db, email, token);
  db.data[email] = { state: body.state || {}, exportedAt: String(body.exportedAt || new Date().toISOString()) };
  writeDb_(db);
  return jsonOut_({ ok: true, exportedAt: db.data[email].exportedAt });
}

function handleRestore_(db, body) {
  const email = normEmail_(body.email);
  const token = String(body.token || "");
  requireSession_(db, email, token);
  const rec = db.data[email];
  if (!rec) return jsonOut_({ ok: true, state: null, exportedAt: null });
  return jsonOut_({ ok: true, state: rec.state || {}, exportedAt: rec.exportedAt || null });
}

function handleMeta_(db, body) {
  const email = normEmail_(body.email);
  const token = String(body.token || "");
  requireSession_(db, email, token);
  const rec = db.data[email];
  if (!rec) return jsonOut_({ ok: true, versions: [] });
  return jsonOut_({ ok: true, versions: [{ versionId: "latest", exportedAt: rec.exportedAt, bytes: JSON.stringify(rec.state||{}).length }] });
}

function handleRestoreVersion_(db, body) {
  return handleRestore_(db, body);
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function getDbFile_() {
  const files = DriveApp.getFilesByName(DB_FILENAME);
  if (files.hasNext()) return files.next();
  return DriveApp.createFile(DB_FILENAME, JSON.stringify({ users:{}, sessions:{}, data:{} }), MimeType.PLAIN_TEXT);
}

function readDb_() {
  const f = getDbFile_();
  let db = { users:{}, sessions:{}, data:{} };
  try { db = JSON.parse(f.getContent() || "{}"); } catch (e) {}
  db.users = db.users || {}; db.sessions = db.sessions || {}; db.data = db.data || {};
  return db;
}

function writeDb_(db) { getDbFile_().setContent(JSON.stringify(db)); }
function normEmail_(email) { return String(email || "").trim().toLowerCase(); }
function sha256b64_(s) { return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)); }
function newToken_() { return Utilities.getUuid() + "-" + Utilities.getUuid(); }
function pruneSessions_(db) { const now = Date.now(); Object.keys(db.sessions||{}).forEach(t => { if (!db.sessions[t] || db.sessions[t].exp <= now) delete db.sessions[t]; }); }
function requireSession_(db, email, token) {
  if (!token) throw new Error("Missing token");
  const sess = db.sessions[token];
  if (!sess) throw new Error("Invalid session");
  if (sess.exp <= Date.now()) { delete db.sessions[token]; throw new Error("Session expired"); }
  if (sess.email !== email) throw new Error("Session email mismatch");
  return sess;
}`;
