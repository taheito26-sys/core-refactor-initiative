import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CHECK_EVERY_MS, LocationReporter, REPORT_INTERVAL_MS, type QueuedPoint } from '@/features/shipments/location-reporter';
import type { Fix } from '@/features/shipments/geo';

const HOUR = REPORT_INTERVAL_MS;
let now = 1_000_000_000_000;
let store: Record<string, string>;
const storage = { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; } };
const fix = (n = 0): Fix => ({ latitude: 25 + n, longitude: 51 + n, accuracy: 10, timestamp: now });

function make(over: Partial<{ getFix: () => Promise<Fix | null>; send: (p: QueuedPoint) => Promise<void> }> = {}) {
  const sent: QueuedPoint[] = [];
  const send = over.send ?? (async (p: QueuedPoint) => { sent.push(p); });
  const getFix = vi.fn(over.getFix ?? (async () => fix()));
  const reporter = new LocationReporter({ getFix, send, now: () => now, storage });
  return { reporter, sent, getFix };
}

beforeEach(() => { now = 1_000_000_000_000; store = {}; });

describe('LocationReporter', () => {
  it('reports straight away for a shipment on the road, then not again until an hour has passed', async () => {
    const { reporter, sent, getFix } = make();
    reporter.setShipments(['s1']);
    await reporter.tick();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ shipmentId: 's1', source: 'auto', latitude: 25 });

    now += CHECK_EVERY_MS * 3;
    await reporter.tick();
    expect(sent).toHaveLength(1);
    expect(getFix).toHaveBeenCalledTimes(1);

    now += HOUR;
    await reporter.tick();
    expect(sent).toHaveLength(2);
  });

  it('does nothing and does not even ask the phone for GPS when no shipment is on the road', async () => {
    const { reporter, sent, getFix } = make();
    reporter.setShipments([]);
    await reporter.tick();
    expect(sent).toHaveLength(0);
    expect(getFix).not.toHaveBeenCalled();
  });

  it('keeps a point when the network is down, with the time it was taken, and sends it when the signal returns', async () => {
    let online = false;
    const delivered: QueuedPoint[] = [];
    const { reporter } = make({ send: async (p) => { if (!online) throw new TypeError('Failed to fetch'); delivered.push(p); } });
    reporter.setShipments(['s1']);
    const takenAt = now;
    await reporter.tick();
    expect(delivered).toHaveLength(0);
    expect(reporter.queued()).toHaveLength(1);

    online = true;
    now += 20 * 60_000;
    await reporter.tick();
    expect(delivered).toHaveLength(1);
    expect(delivered[0].recordedAt).toBe(takenAt);
    expect(reporter.queued()).toHaveLength(0);
  });

  it('survives an app restart: the queue and the last-sent time live in storage', async () => {
    const first = make({ send: async () => { throw new TypeError('offline'); } });
    first.reporter.setShipments(['s1']);
    await first.reporter.tick();

    const second = make();
    second.reporter.setShipments(['s1']);
    await second.reporter.tick();
    expect(second.sent).toHaveLength(1);        // the queued point went out
    expect(second.getFix).not.toHaveBeenCalled(); // and no new GPS reading was due yet
  });

  it('drops a point the server rejects for good, so one bad point never blocks the queue', async () => {
    const delivered: QueuedPoint[] = [];
    let n = 0;
    const { reporter } = make({
      send: async (p) => {
        n += 1;
        if (n === 1) throw Object.assign(new Error('The trip is not on the road'), { code: 'P0001' });
        delivered.push(p);
      },
    });
    reporter.setShipments(['s1', 's2']);
    await reporter.tick();
    expect(delivered).toHaveLength(1);
    expect(delivered[0].shipmentId).toBe('s2');
    expect(reporter.queued()).toHaveLength(0);
  });

  it('waits for the next check when the phone cannot get a fix', async () => {
    let ok = false;
    const { reporter, sent } = make({ getFix: async () => (ok ? fix() : null) });
    reporter.setShipments(['s1']);
    await reporter.tick();
    expect(sent).toHaveLength(0);
    ok = true;
    now += CHECK_EVERY_MS;
    await reporter.tick();
    expect(sent).toHaveLength(1);
  });

  it('counts a fix from the Android background tracker as the hourly report, once an hour', async () => {
    const { reporter, sent, getFix } = make();
    reporter.setShipments(['s1']);
    await reporter.onBackgroundFix(fix(1));
    expect(sent).toHaveLength(1);
    now += 10 * 60_000;
    await reporter.onBackgroundFix(fix(2));
    expect(sent).toHaveLength(1);
    now += HOUR;
    await reporter.onBackgroundFix(fix(3));
    expect(sent).toHaveLength(2);
    expect(getFix).not.toHaveBeenCalled();
  });

  it('restarts the hour when a reading or a stop already reported the position', async () => {
    const { reporter, sent } = make();
    reporter.setShipments(['s1']);
    reporter.noteReported('s1');
    await reporter.tick();
    expect(sent).toHaveLength(0);
  });

  it('keeps the queue bounded so a long outage cannot fill the phone', async () => {
    const { reporter } = make({ send: async () => { throw new TypeError('offline'); } });
    reporter.setShipments(['s1']);
    for (let i = 0; i < 80; i++) { now += HOUR; await reporter.tick(); }
    expect(reporter.queued().length).toBeLessThanOrEqual(60);
  });
});
