import type { Fix } from './geo';

export const REPORT_INTERVAL_MS = 60 * 60 * 1000;
/** How often to check whether an hour has passed; timers drift or pause when the phone sleeps. */
export const CHECK_EVERY_MS = 5 * 60 * 1000;
const QUEUE_KEY = 'shipment-location-queue:v1';
const SENT_KEY = 'shipment-location-last-sent:v1';
const MAX_QUEUE = 60;
const GRACE_MS = 60_000;

export interface QueuedPoint {
  shipmentId: string;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  /** When the phone took the fix, epoch ms. */
  recordedAt: number;
  source: 'auto' | 'stop' | 'reading';
}

interface StorageLike { getItem(k: string): string | null; setItem(k: string, v: string): void }

export interface ReporterDeps {
  /** A fresh fix from the phone, or null when it cannot get one now. */
  getFix: () => Promise<Fix | null>;
  /** Sends one point. Resolves when stored; rejects otherwise. */
  send: (point: QueuedPoint) => Promise<void>;
  now: () => number;
  storage: StorageLike;
}

/** A server answer (it carries a Postgres code) will never succeed on retry; a network failure might. */
const isPermanent = (error: unknown) => typeof (error as { code?: unknown })?.code === 'string';

/**
 * Reports the driver's position about once an hour for every shipment on the road. A point that cannot be
 * sent (no signal through the desert) is kept with the time it was taken and sent when the connection returns.
 */
export class LocationReporter {
  private shipmentIds: string[] = [];
  private flushing = false;

  constructor(private deps: ReporterDeps) {}

  setShipments(ids: string[]) {
    this.shipmentIds = [...ids];
  }

  private read<T>(key: string, fallback: T): T {
    try { return JSON.parse(this.deps.storage.getItem(key) ?? '') as T; } catch { return fallback; }
  }
  private write(key: string, value: unknown) {
    try { this.deps.storage.setItem(key, JSON.stringify(value)); } catch { /* storage full or blocked: keep going in memory terms */ }
  }

  private lastSent(): Record<string, number> { return this.read<Record<string, number>>(SENT_KEY, {}); }
  queued(): QueuedPoint[] { return this.read<QueuedPoint[]>(QUEUE_KEY, []); }

  private enqueue(point: QueuedPoint) {
    const queue = [...this.queued(), point].slice(-MAX_QUEUE);
    this.write(QUEUE_KEY, queue);
  }

  private markSent(shipmentId: string, at: number) {
    this.write(SENT_KEY, { ...this.lastSent(), [shipmentId]: at });
  }

  /** Sends what is waiting, oldest first; stops at the first network failure so the order is kept. */
  async flush() {
    if (this.flushing) return;
    this.flushing = true;
    try {
      let queue = this.queued();
      while (queue.length) {
        const point = queue[0];
        try {
          await this.deps.send(point);
        } catch (e) {
          if (!isPermanent(e)) break;
        }
        queue = queue.slice(1);
        this.write(QUEUE_KEY, queue);
      }
    } finally {
      this.flushing = false;
    }
  }

  /** Called on a timer and when the app comes back to the front or the network returns. */
  async tick() {
    const now = this.deps.now();
    const sent = this.lastSent();
    const due = this.shipmentIds.filter((id) => now - (sent[id] ?? 0) >= REPORT_INTERVAL_MS - GRACE_MS);
    if (due.length) {
      const fix = await this.deps.getFix();
      if (fix) {
        for (const shipmentId of due) {
          this.enqueue({ shipmentId, latitude: fix.latitude, longitude: fix.longitude, accuracy: fix.accuracy, recordedAt: fix.timestamp, source: 'auto' });
          this.markSent(shipmentId, now);
        }
      }
    }
    await this.flush();
  }

  /**
   * A fix the Android background tracker delivered. It counts as the hourly report when one is due, so the
   * phone is not asked for a second GPS reading.
   */
  async onBackgroundFix(fix: Fix) {
    const now = this.deps.now();
    const sent = this.lastSent();
    let any = false;
    for (const shipmentId of this.shipmentIds) {
      if (now - (sent[shipmentId] ?? 0) >= REPORT_INTERVAL_MS - GRACE_MS) {
        this.enqueue({ shipmentId, latitude: fix.latitude, longitude: fix.longitude, accuracy: fix.accuracy, recordedAt: fix.timestamp, source: 'auto' });
        this.markSent(shipmentId, now);
        any = true;
      }
    }
    if (any) await this.flush();
  }

  /** A point that came from a reading or a confirmed stop also resets the hour for that shipment. */
  noteReported(shipmentId: string) {
    this.markSent(shipmentId, this.deps.now());
  }
}
