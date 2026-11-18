import type { Shipment, ShipmentEvent } from "./types";
type Timing = Pick<
  Shipment,
  "started_at" | "delivered_at" | "ended_at" | "status" | "sessions" | "events"
>;
export function activeTripMs(trip: Timing, now: number): number | null {
  if (trip.sessions !== undefined)
    return trip.sessions.reduce(
      (sum, s) =>
        sum +
        Math.max(
          0,
          Date.parse(s.ended_at ?? new Date(now).toISOString()) -
            Date.parse(s.started_at),
        ),
      0,
    );
  if (!trip.started_at) return null;
  const end = trip.ended_at ?? trip.delivered_at;
  return Math.max(
    0,
    (end
      ? Date.parse(end)
      : trip.status === "preparing" || trip.status === "cancelled"
        ? Date.parse(trip.started_at)
        : now) - Date.parse(trip.started_at),
  );
}

/**
 * The instant monitoring stopped for a finished trip. Delivered trips use
 * delivered_at, early-ended trips use ended_at, and older records fall back to
 * the last closed session. Live or preparing trips have no end.
 */
export function shipmentEndMs(
  trip: Pick<Shipment, "status" | "ended_at" | "delivered_at" | "sessions">,
): number | null {
  if (!["delivered", "ended_early", "cancelled"].includes(trip.status)) return null;

  const candidates = [
    trip.ended_at,
    trip.delivered_at,
    ...(trip.sessions ?? []).map((session) => session.ended_at),
  ].filter((value): value is string => Boolean(value));

  const times = candidates
    .map((value) => Date.parse(value))
    .filter((value) => Number.isFinite(value));
  return times.length ? Math.max(...times) : null;
}
export function approvalWaitMs(
  events: ShipmentEvent[] | undefined,
  now: number,
  endedAt?: string | null,
): number {
  if (!events?.some((event) => event.event_type === "ended_early"))
    return endedAt ? Math.max(0, now - Date.parse(endedAt)) : 0;
  let waiting: number | null = null,
    total = 0;
  for (const e of [...events].sort(
    (a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at),
  )) {
    if (e.event_type === "ended_early") waiting = Date.parse(e.occurred_at);
    if (
      waiting !== null &&
      ["restart_approved", "cancelled", "delivered"].includes(e.event_type)
    ) {
      total += Math.max(0, Date.parse(e.occurred_at) - waiting);
      waiting = null;
    }
  }
  return total + (waiting === null ? 0 : Math.max(0, now - waiting));
}
