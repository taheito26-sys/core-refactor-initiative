import { submitReading, type ReadingInput } from "./api";
export const UPLOAD_EVENT = "shipment-reading-upload-change";
export interface QueuedReading {
  id: string;
  owner: string;
  input: ReadingInput;
  status: "waiting" | "uploading" | "failed";
  error?: string;
  retryable: boolean;
  updatedAt: number;
}
const memory = new Map<string, QueuedReading>();
const locks = new Map<string, Promise<unknown>>();
export const durableReadingStorage = () => typeof indexedDB !== "undefined";
let opening: Promise<IDBDatabase> | null = null;
function database(): Promise<IDBDatabase> {
  if (!opening)
    opening = new Promise((resolve, reject) => {
      const r = indexedDB.open("shipment-reading-outbox-v1", 1);
      r.onupgradeneeded = () =>
        r.result.createObjectStore("readings", { keyPath: "id" });
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => {
        opening = null;
        reject(r.error);
      };
    });
  return opening;
}
async function transaction<T>(
  mode: IDBTransactionMode,
  action: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const t = db.transaction("readings", mode);
    const r = action(t.objectStore("readings"));
    let result: T;
    r.onsuccess = () => {
      result = r.result;
    };
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error ?? r.error);
    t.onabort = () =>
      reject(t.error ?? new Error("Could not save the photo on this device"));
  });
}
const notify = (id?: string, sent = false) => {
  if (typeof window !== "undefined")
    window.dispatchEvent(
      new CustomEvent(UPLOAD_EVENT, { detail: { id, sent } }),
    );
};
async function put(item: QueuedReading) {
  if (durableReadingStorage())
    await transaction("readwrite", (s) => s.put(item));
  else memory.set(item.id, item);
  notify(item.id);
}
export async function listQueuedReadings(
  owner: string,
): Promise<QueuedReading[]> {
  const rows = durableReadingStorage()
    ? ((await transaction("readonly", (s) => s.getAll())) as QueuedReading[])
    : [...memory.values()];
  return rows
    .filter((x) => x.owner === owner)
    .sort((a, b) => a.input.capturedAt - b.input.capturedAt);
}
export async function discardQueuedReading(owner: string, id: string) {
  const rows = await listQueuedReadings(owner);
  if (!rows.some((x) => x.id === id)) return;
  if (durableReadingStorage())
    await transaction("readwrite", (s) => s.delete(id));
  else memory.delete(id);
  notify(id);
}
export async function enqueueReading(
  owner: string,
  input: ReadingInput,
): Promise<QueuedReading> {
  if (!owner) throw new Error("Sign in before saving a reading");
  const id = input.clientRequestId ?? crypto.randomUUID();
  const rows = await listQueuedReadings(owner);
  const existing = rows.find((x) => x.id === id);
  if (existing) return existing;
  if (rows.length >= 20)
    throw new Error(
      "There are 20 pending photos. Send or discard one before adding another.",
    );
  const item: QueuedReading = {
    id,
    owner,
    input: { ...input, clientRequestId: id },
    status: "waiting",
    retryable: true,
    updatedAt: Date.now(),
  };
  await put(item);
  return item;
}
function retryable(error: unknown) {
  const e = error as { code?: string; status?: number; statusCode?: string };
  return (
    e.code === "PGRST202" ||
    (!e.code &&
      ((!e.status && !e.statusCode) || Number(e.status ?? e.statusCode) >= 500))
  );
}
export async function sendQueuedReading(
  owner: string,
  id: string,
  sender: (input: ReadingInput) => Promise<unknown> = submitReading,
): Promise<unknown> {
  if (locks.has(id)) return locks.get(id);
  const work = (async () => {
    const row = (await listQueuedReadings(owner)).find((x) => x.id === id);
    if (!row) throw new Error("This pending reading is no longer available");
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      await put({ ...row, status: "waiting", updatedAt: Date.now() });
      throw new Error("SAVED_OFFLINE");
    }
    await put({
      ...row,
      status: "uploading",
      updatedAt: Date.now(),
      error: undefined,
    });
    try {
      const result = await sender(row.input);
      await discardQueuedReading(owner, id);
      notify(id, true);
      return result;
    } catch (error) {
      await put({
        ...row,
        status:
          typeof navigator !== "undefined" && navigator.onLine === false
            ? "waiting"
            : "failed",
        retryable: retryable(error),
        error: (error as Error).message,
        updatedAt: Date.now(),
      });
      throw error;
    }
  })();
  locks.set(id, work);
  try {
    return await work;
  } finally {
    locks.delete(id);
  }
}
export async function flushReadingOutbox(
  owner: string,
  force = false,
): Promise<number> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return 0;
  let sent = 0;
  for (const row of await listQueuedReadings(owner)) {
    if (row.status === "uploading" && locks.has(row.id)) continue;
    if (
      row.status === "failed" &&
      (!row.retryable || (!force && Date.now() - row.updatedAt < 30_000))
    )
      continue;
    try {
      await sendQueuedReading(owner, row.id);
      sent++;
    } catch {
      /* The saved status explains the failure; keep the photo for retry. */
    }
  }
  return sent;
}
