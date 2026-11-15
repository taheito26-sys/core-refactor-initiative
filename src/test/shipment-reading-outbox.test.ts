import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/features/shipments/api", () => ({ submitReading: vi.fn() }));
import {
  enqueueReading,
  listQueuedReadings,
  sendQueuedReading,
  discardQueuedReading,
  flushReadingOutbox,
} from "@/features/shipments/reading-outbox";
import type { ReadingInput } from "@/features/shipments/api";
let owner: string;
const input = (): ReadingInput => ({
  shipmentId: "trip",
  clientRequestId: crypto.randomUUID(),
  photo: new Blob(["proof"]),
  temperatureC: -15,
  setPointC: -15,
  note: "checked",
  fix: { latitude: 31, longitude: 31, accuracy: 10, timestamp: Date.now() },
  capturedAt: Date.now(),
  entryMode: "manual",
  read: null,
  place: null,
});
beforeEach(() => {
  owner = crypto.randomUUID();
  Object.defineProperty(navigator, "onLine", {
    value: true,
    configurable: true,
  });
});
describe("Photo outbox", () => {
  it("preserves the same request, photo and entered values across failed attempts", async () => {
    const payload = input();
    const saved = await enqueueReading(owner, payload);
    const sender = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("network"))
      .mockResolvedValueOnce({ id: "saved" });
    await expect(sendQueuedReading(owner, saved.id, sender)).rejects.toThrow(
      "network",
    );
    expect((await listQueuedReadings(owner))[0]).toMatchObject({
      id: saved.id,
      status: "failed",
      input: { temperatureC: -15, note: "checked" },
    });
    expect((await listQueuedReadings(owner))[0].input.photo).toBe(
      payload.photo,
    );
    await sendQueuedReading(owner, saved.id, sender);
    expect(sender.mock.calls[0][0].clientRequestId).toBe(
      sender.mock.calls[1][0].clientRequestId,
    );
    expect(await listQueuedReadings(owner)).toHaveLength(0);
  });
  it("queues offline and never attempts to send under another account", async () => {
    Object.defineProperty(navigator, "onLine", {
      value: false,
      configurable: true,
    });
    const row = await enqueueReading(owner, input());
    const send = vi.fn();
    await expect(sendQueuedReading(owner, row.id, send)).rejects.toThrow(
      "SAVED_OFFLINE",
    );
    expect(send).not.toHaveBeenCalled();
    expect((await listQueuedReadings(owner))[0].status).toBe("waiting");
    expect(await listQueuedReadings("other-user")).toHaveLength(0);
    await discardQueuedReading("other-user", row.id);
    expect(await listQueuedReadings(owner)).toHaveLength(1);
  });
  it("coalesces simultaneous retries into one send", async () => {
    const row = await enqueueReading(owner, input());
    let finish: (v: unknown) => void = () => {};
    const sender = vi.fn(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const a = sendQueuedReading(owner, row.id, sender),
      b = sendQueuedReading(owner, row.id, sender);
    await vi.waitFor(() => expect(sender).toHaveBeenCalledTimes(1));
    finish({ id: "ok" });
    await Promise.all([a, b]);
  });
  it("does not automatically repeat a permanent server rejection or drop its proof", async () => {
    const row = await enqueueReading(owner, input());
    await expect(
      sendQueuedReading(owner, row.id, async () => {
        throw { code: "P0001", message: "Trip ended" };
      }),
    ).rejects.toMatchObject({ code: "P0001" });
    expect((await listQueuedReadings(owner))[0].retryable).toBe(false);
    expect(await flushReadingOutbox(owner, true)).toBe(0);
  });
});
