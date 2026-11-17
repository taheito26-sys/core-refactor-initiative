import { stopProgress, type Lang, type StopProgress } from './route';
import type { Shipment, ShipmentStop } from './types';

// ─── Journey view: progress, expected arrival and where the truck sits on the map ───

/** Whole-number progress along the route: each confirmed stop after the first is one finished leg. */
export function journeyPercent(progress: Pick<StopProgress, 'reachedCount' | 'total'>, delivered: boolean): number {
  if (delivered) return 100;
  if (progress.total < 2 || progress.reachedCount < 1) return 0;
  return Math.round(((progress.reachedCount - 1) / (progress.total - 1)) * 100);
}

export interface Eta { at: number; /** The truck is slower than its own pace so far. */ slow: boolean }

/**
 * Expected arrival from the truck's own pace: the average time per finished leg, repeated for the legs that
 * remain, counted from the last confirmed stop. Null until at least one leg has been finished.
 */
export function estimateArrival(shipment: Pick<Shipment, 'status' | 'started_at' | 'delivered_at'>, stops: ShipmentStop[], now: number): Eta | null {
  if (shipment.status !== 'on_the_road' || !shipment.started_at) return null;
  const p = stopProgress(stops);
  const reached = p.stops.filter(s => s.reached_at);
  if (reached.length < 2 || !p.next) return null;
  const start = Date.parse(shipment.started_at);
  const last = Date.parse(reached[reached.length - 1].reached_at as string);
  const legsDone = reached.length - 1;
  const perLeg = (last - start) / legsDone;
  if (!Number.isFinite(perLeg) || perLeg <= 0) return null;
  const legsLeft = p.total - reached.length;
  const at = last + perLeg * legsLeft;
  return { at: Math.max(at, now), slow: now - last > perLeg * 1.5 };
}

/** "Thursday, morning" – a day and a part of the day, since an exact minute would promise too much. */
export function dayPartLabel(at: number, lang: Lang): string {
  const d = new Date(at);
  const h = d.getHours();
  const part = h < 5 ? 'night' : h < 12 ? 'morning' : h < 17 ? 'afternoon' : h < 21 ? 'evening' : 'night';
  const ar = { night: 'ليلًا', morning: 'صباحًا', afternoon: 'ظهرًا', evening: 'مساءً' }[part];
  const day = d.toLocaleDateString(lang === 'ar' ? 'ar-u-nu-latn' : 'en-GB', { weekday: 'long' });
  return lang === 'ar' ? `${day} ${ar}` : `${day}, ${part}`;
}

export interface MapPoint { x: number; y: number }

/** The drawn route, Egypt to Qatar, as corner points on a 300 x 180 map. */
export const MAP_ROUTE: MapPoint[] = [
  { x: 40, y: 140 }, { x: 78, y: 118 }, { x: 108, y: 92 }, { x: 150, y: 70 }, { x: 196, y: 84 }, { x: 232, y: 104 }, { x: 262, y: 98 },
];

/** n points spread at equal distances along the drawn route. */
export function spreadAlong(route: MapPoint[], n: number): MapPoint[] {
  if (n <= 0) return [];
  if (n === 1) return [route[0]];
  const lens = route.slice(1).map((p, i) => Math.hypot(p.x - route[i].x, p.y - route[i].y));
  const total = lens.reduce((a, b) => a + b, 0);
  return Array.from({ length: n }, (_, k) => {
    let d = (k / (n - 1)) * total;
    for (let i = 0; i < lens.length; i++) {
      if (d <= lens[i] || i === lens.length - 1) {
        const f = lens[i] ? Math.min(1, d / lens[i]) : 0;
        return { x: route[i].x + (route[i + 1].x - route[i].x) * f, y: route[i].y + (route[i + 1].y - route[i].y) * f };
      }
      d -= lens[i];
    }
    return route[route.length - 1];
  });
}
