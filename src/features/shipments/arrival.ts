import { haversineKm, type Fix } from "./geo";
import type { ShipmentStop } from "./types";
export type ArrivalAssessment = {
  verified: boolean;
  distanceKm: number | null;
  issue: "no_area" | "no_fix" | "inaccurate" | "far" | null;
};
export function assessArrival(
  stop: ShipmentStop,
  fix: Fix | null,
  now: number,
): ArrivalAssessment {
  if (stop.latitude == null || stop.longitude == null)
    return { verified: false, distanceKm: null, issue: "no_area" };
  if (
    !fix ||
    !Number.isFinite(fix.latitude) ||
    !Number.isFinite(fix.longitude) ||
    Math.abs(fix.latitude) > 90 ||
    Math.abs(fix.longitude) > 180
  )
    return { verified: false, distanceKm: null, issue: "no_fix" };
  const distanceKm = haversineKm(fix, {
    latitude: stop.latitude,
    longitude: stop.longitude,
  });
  if (
    fix.accuracy == null ||
    fix.accuracy < 0 ||
    fix.accuracy > 1000 ||
    fix.timestamp < now - 600_000 ||
    fix.timestamp > now + 60_000
  )
    return { verified: false, distanceKm, issue: "inaccurate" };
  return {
    verified: distanceKm <= (stop.radius_km ?? 20),
    distanceKm,
    issue: distanceKm <= (stop.radius_km ?? 20) ? null : "far",
  };
}
