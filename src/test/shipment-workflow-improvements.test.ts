import { describe, expect, it } from "vitest";
import { assessArrival } from "@/features/shipments/arrival";
import { activeTripMs, approvalWaitMs } from "@/features/shipments/timing";
import {
  gpsCoverage,
  tripPunctuality,
} from "@/features/shipments/driver-stats";
import { readingDue } from "@/features/shipments/route";
import type { ShipmentEvent, ShipmentStop } from "@/features/shipments/types";
const H = 3600_000,
  now = Date.parse("2026-11-15T12:00:00Z");
const iso = (h: number) => new Date(now + h * H).toISOString();
const stop = {
  id: "s",
  shipment_id: "t",
  seq: 2,
  name_en: "Kafr El Sheikh",
  name_ar: "كفر الشيخ",
  kind: "fixed",
  reached_at: null,
  latitude: 31.111,
  longitude: 30.939,
  radius_km: 20,
} as ShipmentStop;
const fix = {
  latitude: 31.111,
  longitude: 30.939,
  accuracy: 20,
  timestamp: now,
};
describe("Arrival evidence", () => {
  it("verifies accurate GPS near the stop and warns far away", () => {
    expect(assessArrival(stop, fix, now).verified).toBe(true);
    expect(
      assessArrival(stop, { ...fix, latitude: 25.285, longitude: 51.531 }, now)
        .issue,
    ).toBe("far");
  });
  it("does not claim a match with stale, inaccurate, missing or unspecified GPS evidence", () => {
    expect(
      assessArrival(stop, { ...fix, timestamp: now - 11 * 60_000 }, now)
        .verified,
    ).toBe(false);
    expect(assessArrival(stop, { ...fix, accuracy: 5000 }, now).issue).toBe(
      "inaccurate",
    );
    expect(assessArrival(stop, null, now).issue).toBe("no_fix");
    expect(
      assessArrival({ ...stop, latitude: null, longitude: null }, fix, now)
        .issue,
    ).toBe("no_area");
  });
});
describe("Trip sessions and gaps", () => {
  const sessions = [
    { started_at: iso(-10), ended_at: iso(-8) },
    { started_at: iso(-2), ended_at: null },
  ];
  const trip = {
    started_at: iso(-10),
    ended_at: null,
    delivered_at: null,
    status: "on_the_road" as const,
    sessions,
  };
  it("counts four active hours rather than ten calendar hours", () =>
    expect(activeTripMs(trip, now)).toBe(4 * H));
  it("counts only the wait for client approval, excluding the later driver acceptance gap", () => {
    const events = [
      { event_type: "ended_early", occurred_at: iso(-8) },
      { event_type: "restart_approved", occurred_at: iso(-4) },
      { event_type: "started", occurred_at: iso(-2) },
    ] as ShipmentEvent[];
    expect(approvalWaitMs(events, now)).toBe(4 * H);
  });
  it("does not count missed readings while the client has not authorized another start", () => {
    const result = tripPunctuality(
      {
        ...trip,
        weight_tons: 1,
        reading_interval_hours: 3,
        stops: [],
        readings: [],
        locations: [],
      },
      now,
    );
    expect(result.missed).toBe(0);
  });
  it("starts the next reading deadline from the new run rather than an old photo", () => {
    const due = readingDue(
      {
        status: "on_the_road",
        started_at: iso(-10),
        current_started_at: iso(-2),
        reading_interval_hours: 3,
      },
      iso(-9),
      now,
    );
    expect(due.dueAt).toBe(now + H);
    expect(due.state).toBe("ok");
  });
});
it("identifies sparse GPS coverage instead of implying an odometer distance", () => {
  const points = [
    { latitude: 31, longitude: 31, recorded_at: iso(-10) },
    { latitude: 31.1, longitude: 31.1, recorded_at: iso(-9) },
  ];
  expect(gpsCoverage(points, 10 * H)).toEqual({
    samples: 2,
    percent: 10,
    incomplete: true,
  });
  expect(gpsCoverage([], 10 * H).incomplete).toBe(true);
});
