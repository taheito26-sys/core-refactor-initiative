/*
 * Device-local "remember me" store for the sign-in form.
 *
 * Why this exists: iOS home-screen web apps (and the Capacitor shell) run in a
 * WebView that has no access to the system password manager. Safari therefore
 * never offers its "Save Password" sheet there, so every launch started with an
 * empty form. The app keeps its own copy instead:
 *
 * - the identifier (username or email) is stored as plain text so the field can
 *   be prefilled synchronously on first paint;
 * - the password is only stored when the user ticks "remember me", and it is
 *   sealed with AES-GCM under a non-extractable key that lives in IndexedDB.
 *   The key never leaves the browser's crypto store and is never written to
 *   localStorage, so a dumped localStorage does not expose the password.
 *
 * If the platform has no WebCrypto/IndexedDB (insecure context, private mode)
 * the module degrades to remembering the identifier only — never a plaintext
 * password.
 */

export interface SavedLogin {
  identifier: string;
  password: string;
  remember: boolean;
}

interface StoredRecord {
  v: 1;
  identifier: string;
  remember: boolean;
  iv?: string;
  cipher?: string;
}

const STORAGE_KEY = 'saved-login-v1';
const DB_NAME = 'tracker-login-keys';
const DB_VERSION = 1;
const KEY_STORE = 'keys';
const KEY_ID = 'login-secret';

function safeStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function readRecord(): StoredRecord | null {
  const store = safeStorage();
  if (!store) return null;
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredRecord;
    if (!parsed || parsed.v !== 1 || typeof parsed.identifier !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeRecord(record: StoredRecord): void {
  const store = safeStorage();
  if (!store) return;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch {
    // Storage full or blocked: remembering is best effort.
  }
}

/** Synchronous read used to seed the username field before first paint. */
export function getRememberedIdentifier(): string {
  return readRecord()?.identifier ?? '';
}

/** The checkbox starts ticked unless the user turned it off last time. */
export function getRememberPreference(): boolean {
  return readRecord()?.remember ?? true;
}

export function clearSavedLogin(): void {
  const store = safeStorage();
  try {
    store?.removeItem(STORAGE_KEY);
  } catch {
    // best effort
  }
}

/** Resolves with the stored credentials, decrypting the password when present. */
export async function loadSavedLogin(): Promise<SavedLogin | null> {
  const record = readRecord();
  if (!record) return null;
  let password = '';
  if (record.iv && record.cipher) {
    password = (await decryptText(record.iv, record.cipher)) ?? '';
  }
  return { identifier: record.identifier, password, remember: record.remember };
}

/**
 * Persists the identifier always, and the password only when `remember` is on.
 * Call it after a successful sign-in so a typo never overwrites good credentials.
 */
export async function saveLogin(
  identifier: string,
  password: string,
  remember: boolean,
): Promise<void> {
  const clean = identifier.trim();
  if (!clean) {
    clearSavedLogin();
    return;
  }
  if (!remember || !password) {
    writeRecord({ v: 1, identifier: clean, remember: false });
    return;
  }
  const sealed = await encryptText(password);
  if (!sealed) {
    // No WebCrypto: keep the username, never the password.
    writeRecord({ v: 1, identifier: clean, remember: false });
    return;
  }
  writeRecord({
    v: 1,
    identifier: clean,
    remember: true,
    iv: sealed.iv,
    cipher: sealed.cipher,
  });
}

// ── Crypto helpers ──────────────────────────────────────────────────────────

function subtleCrypto(): SubtleCrypto | null {
  if (typeof crypto === 'undefined') return null;
  return crypto.subtle ?? null;
}

function openKeyDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise(resolve => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(KEY_STORE)) db.createObjectStore(KEY_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

function readKey(db: IDBDatabase): Promise<CryptoKey | null> {
  return new Promise(resolve => {
    try {
      const tx = db.transaction(KEY_STORE, 'readonly');
      const req = tx.objectStore(KEY_STORE).get(KEY_ID);
      req.onsuccess = () => resolve((req.result as CryptoKey | undefined) ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function storeKey(db: IDBDatabase, key: CryptoKey): Promise<void> {
  return new Promise(resolve => {
    try {
      const tx = db.transaction(KEY_STORE, 'readwrite');
      tx.objectStore(KEY_STORE).put(key, KEY_ID);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

async function getOrCreateKey(): Promise<CryptoKey | null> {
  const subtle = subtleCrypto();
  if (!subtle) return null;
  const db = await openKeyDb();
  if (!db) return null;
  try {
    const existing = await readKey(db);
    if (existing) return existing;
    const created = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
      'decrypt',
    ]);
    await storeKey(db, created);
    return created;
  } catch {
    return null;
  } finally {
    db.close();
  }
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function encryptText(text: string): Promise<{ iv: string; cipher: string } | null> {
  const subtle = subtleCrypto();
  const key = await getOrCreateKey();
  if (!subtle || !key) return null;
  try {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      new TextEncoder().encode(text),
    );
    return { iv: toBase64(iv), cipher: toBase64(new Uint8Array(encrypted)) };
  } catch {
    return null;
  }
}

async function decryptText(iv: string, cipher: string): Promise<string | null> {
  const subtle = subtleCrypto();
  const key = await getOrCreateKey();
  if (!subtle || !key) return null;
  try {
    const plain = await subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(iv) },
      key,
      fromBase64(cipher),
    );
    return new TextDecoder().decode(plain);
  } catch {
    // Key rotated or the record was tampered with: drop the stale password.
    return null;
  }
}
