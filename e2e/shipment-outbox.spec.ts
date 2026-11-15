import { expect, test } from "@playwright/test";
test.use({
  launchOptions: {
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  },
});
test("a queued offline photo survives reload, keeps its account and values, and sends once", async ({
  page,
  context,
}) => {
  const origin = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:5000";
  await page.route("**/outbox-test", (r) =>
    r.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Outbox verification</title>",
    }),
  );
  await page.goto(origin + "/outbox-test");
  const seed = await page.evaluate(async () => {
    const path = "/src/features/shipments/reading-outbox.ts";
    const outbox = await import(path);
    Reflect.set(window, "testOutbox", outbox);
    const owner = crypto.randomUUID();
    const row = await outbox.enqueueReading(owner, {
      shipmentId: "fixture-trip",
      clientRequestId: crypto.randomUUID(),
      photo: new Blob(["preserved photo"], { type: "image/jpeg" }),
      temperatureC: -14.5,
      setPointC: -15,
      note: "original values",
      fix: { latitude: 31, longitude: 31, accuracy: 15, timestamp: Date.now() },
      capturedAt: Date.now(),
      entryMode: "manual",
      read: null,
      place: null,
    });
    return { owner, id: row.id };
  });
  await context.setOffline(true);
  const waiting = await page.evaluate(async (seed) => {
    const outbox = Reflect.get(window, "testOutbox");
    try {
      await outbox.sendQueuedReading(seed.owner, seed.id);
    } catch {}
    return (await outbox.listQueuedReadings(seed.owner))[0].status;
  }, seed);
  expect(waiting).toBe("waiting");
  await context.setOffline(false);
  await page.reload();
  const saved = await page.evaluate(async (seed) => {
    const path = "/src/features/shipments/reading-outbox.ts";
    const outbox = await import(path);
    const rows = await outbox.listQueuedReadings(seed.owner);
    const row = rows[0];
    const result = {
      id: row.id,
      temp: row.input.temperatureC,
      note: row.input.note,
      photo: await row.input.photo.text(),
      other: (await outbox.listQueuedReadings("different-account")).length,
    };
    await outbox.sendQueuedReading(seed.owner, row.id, async () => ({
      id: "mock-server-receipt",
    }));
    return {
      ...result,
      remaining: (await outbox.listQueuedReadings(seed.owner)).length,
    };
  }, seed);
  expect(saved).toEqual({
    id: seed.id,
    temp: -14.5,
    note: "original values",
    photo: "preserved photo",
    other: 0,
    remaining: 0,
  });
});
