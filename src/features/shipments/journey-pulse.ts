import { projectCorridor } from './corridor-geo';
import { haversineKm } from './geo';
import { agoLabel, durationLabel, latestReading, stopName, stopProgress, type Lang } from './route';
import type { ShipmentStop, ShipmentWithDetails } from './types';

/** How a journey is told: the driver needs the next move, the customer needs the promise. */
export type JourneyAudience = 'driver' | 'customer';

/** The fixed stops carry coordinates in the database; these fallbacks keep older rows on the map. */
const STOP_COORDINATES: Record<string, readonly [number, number]> = {
  'Supplier Farm B': [30.6, 30.9],
  'Salwa border': [24.7, 50.8],
  'Doha Warehouse 02': [25.285, 51.531],
  'Obour (Cairo)': [30.228, 31.482],
  'Kafr El Sheikh': [31.111, 30.939],
  'Port Said': [31.265, 32.302],
  'Safaga port': [26.733, 33.936],
  'Saudi Arabia': [26.2, 44.0],
  'Qatar (delivery)': [25.285, 51.531],
  'Kafr El-Sheikh, Egypt': [31.111, 30.939],
  'Safaga Port, Egypt': [26.733, 33.936],
  'Duba Port, Saudi Arabia': [27.35, 35.69],
  'Tabuk, Saudi Arabia': [28.384, 36.555],
  'Buraydah (Al-Qassim), Saudi Arabia': [26.326, 43.975],
  'Riyadh, Saudi Arabia': [24.713, 46.675],
  'Al-Hofuf (Al-Ahsa), Saudi Arabia': [25.364, 49.588],
  'Salwa / Abu Samra Border Crossing': [24.72, 50.79],
  'Doha, Qatar': [25.285, 51.531],
};

/** Average door-to-door pace for a reefer truck, including the ferry and border time. */
const AVERAGE_KMH = 52;
const MIN_LEG_HOURS = 1.5;
const SCHEDULE_TOLERANCE_MS = 30 * 60_000;
/** A fix this close to a confirmed arrival can still describe the same stop; an older fix belongs to a finished leg. */
const FIX_FRESHNESS_MS = 15 * 60_000;

export type JourneyTone = 'live' | 'ok' | 'warn' | 'bad' | 'muted';
export type MilestoneState = 'done' | 'next' | 'waiting' | 'pending';
export type MilestoneKind = 'origin' | 'waypoint' | 'destination';
export type EtaConfidence = 'high' | 'medium' | 'low';

export interface CorridorStop {
  id: string;
  name: string;
  /** Projected position inside the 760 × 360 corridor viewBox. */
  x: number;
  y: number;
  /** Share of the planned route already behind this stop, 0–100. */
  atPct: number;
  reached: boolean;
  next: boolean;
  destination: boolean;
  kind: 'fixed' | 'driver';
}

export interface JourneyMilestone {
  key: MilestoneKind;
  kind: MilestoneKind;
  state: MilestoneState;
  name: string;
  caption: string;
  time: string | null;
  /** Only the next stop carries an action on the driver side. */
  actionable?: boolean;
}

export interface StopEta {
  id: string;
  name: string;
  reached: boolean;
  next: boolean;
  state: 'done' | 'next' | 'later' | 'pending';
  /** Actual arrival for a reached stop, or the pace-adjusted estimate for a stop still ahead. */
  timeLabel: string | null;
  /** The same instant in epoch milliseconds, for ordering and the total-trip check. */
  etaMs: number | null;
  caption: string;
}

export interface JourneyPlan {
  statusNow: string;
  statusHint: string;
  statusTone: JourneyTone;
  etaMs: number | null;
  nextEtaMs: number | null;
  etaLabel: string;
  etaHint: string;
  etaConfidence: EtaConfidence;
  scheduleTone: JourneyTone;
  progressPct: number;
  reachedCount: number;
  total: number;
  remainingStops: number;
  distanceToNextKm: number | null;
  nextStop: ShipmentStop | null;
  origin: ShipmentStop | null;
  destination: ShipmentStop | null;
  current: ShipmentStop | null;
  milestones: JourneyMilestone[];
  stopEtas: StopEta[];
  totalTripMs: number | null;
  totalTripLabel: string;
  remainingMs: number | null;
  remainingLabel: string;
  corridorStops: CorridorStop[];
  truck: { x: number; y: number } | null;
  truckAtStop: boolean;
  lastFixAt: string | null;
  /** The newest fix is at or after the last confirmed arrival (within the freshness window). */
  fixFresh: boolean;
  coldChainLabel: string;
  coldChainTone: JourneyTone;
  inRangePct: number | null;
  readingsCount: number;
  alertCount: number;
  shareText: string;
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const valid = (n: number | null | undefined): n is number =>
  typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 180;

/** The stop's real position, or the known fixed-route fallback for older shipments. */
export function stopCoordinates(stop: ShipmentStop): { latitude: number; longitude: number } | null {
  if (valid(stop.latitude) && valid(stop.longitude)) {
    return { latitude: stop.latitude, longitude: stop.longitude };
  }
  const fallback = STOP_COORDINATES[stop.name_en] ?? STOP_COORDINATES[stop.name_ar];
  return fallback ? { latitude: fallback[0], longitude: fallback[1] } : null;
}

/** The newest position the driver has shared, if it is a usable fix. */
export function newestFix(shipment: Pick<ShipmentWithDetails, 'locations'>) {
  return [...shipment.locations]
    .filter((p) => valid(p.latitude) && valid(p.longitude))
    .sort((a, b) => Date.parse(b.recorded_at) - Date.parse(a.recorded_at))[0] ?? null;
}

const hoursBetween = (a: number, b: number) => Math.max(0, (b - a) / 3_600_000);

/** A straight-line leg estimate. It is a plan, not a promise; the ETA adapts it to the real pace. */
function legHours(a: { latitude: number; longitude: number } | null, b: { latitude: number; longitude: number } | null): number {
  if (!a || !b) return 6;
  return Math.max(MIN_LEG_HOURS, haversineKm(a, b) / AVERAGE_KMH);
}

export function formatJourneyTime(ms: number, lang: Lang, withWeekday = false): string {
  return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG' : 'en-GB', {
    ...(withWeekday ? { weekday: 'short' as const } : {}),
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(ms));
}

/** "Today, 18:40" is easier to act on than a bare timestamp; tomorrow and later keep their weekday. */
export function relativeDayLabel(ms: number, now: number, lang: Lang): string {
  const day = (n: number) => new Date(n).toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-GB', { weekday: 'short' });
  const sameDay = new Date(ms).toDateString() === new Date(now).toDateString();
  const tomorrow = new Date(now + 86_400_000).toDateString() === new Date(ms).toDateString();
  const time = new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG' : 'en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ms));
  if (sameDay) return lang === 'ar' ? `اليوم ${time}` : `Today, ${time}`;
  if (tomorrow) return lang === 'ar' ? `غدًا ${time}` : `Tomorrow, ${time}`;
  return `${day(ms)} ${time}`;
}

function statusCopy(shipment: ShipmentWithDetails, lang: Lang, now: number, progress: ReturnType<typeof stopProgress>, fix: ShipmentWithDetails['locations'][number] | null) {
  const L = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  const current = progress.current;
  const origin = progress.origin;
  const destination = progress.destination;
  const start = shipment.current_started_at ?? shipment.started_at;
  const livePlace = fix ? (lang === 'ar' ? fix.place_ar : fix.place_en) : null;
  switch (shipment.status) {
    case 'preparing':
      return {
        statusNow: origin ? stopName(origin, lang) : L('Preparing', 'قيد التجهيز'),
        statusHint: L('Awaiting driver', 'بانتظار السائق'),
        statusTone: 'muted' as JourneyTone,
      };
    case 'on_the_road':
      return {
        statusNow: livePlace || (current ? stopName(current, lang) : (origin ? stopName(origin, lang) : L('On the road', 'في الطريق'))),
        statusHint: current?.reached_at
          ? L(`Left ${agoLabel(current.reached_at, now, lang)}`, `غادر ${agoLabel(current.reached_at, now, lang)}`)
          : start
            ? L(`Departed ${agoLabel(start, now, lang)}`, `انطلقت ${agoLabel(start, now, lang)}`)
            : L('On the road', 'في الطريق'),
        statusTone: 'live' as JourneyTone,
      };
    case 'delivered':
      return {
        statusNow: destination ? stopName(destination, lang) : L('Delivered', 'تم التسليم'),
        statusHint: shipment.delivered_at
          ? L(`Delivered ${agoLabel(shipment.delivered_at, now, lang)}`, `سُلّمت ${agoLabel(shipment.delivered_at, now, lang)}`)
          : L('Delivered', 'تم التسليم'),
        statusTone: 'ok' as JourneyTone,
      };
    case 'ended_early':
      return {
        statusNow: L('Trip paused', 'الرحلة متوقفة'),
        statusHint: L('Waiting for the customer to approve a restart', 'بانتظار موافقة العميل على الاستئناف'),
        statusTone: 'warn' as JourneyTone,
      };
    case 'cancelled':
      return {
        statusNow: L('Cancelled', 'ملغاة'),
        statusHint: L('This trip will not continue', 'لن تستمر هذه الرحلة'),
        statusTone: 'muted' as JourneyTone,
      };
    default:
      return { statusNow: L('Shipment', 'الشحنة'), statusHint: '', statusTone: 'muted' as JourneyTone };
  }
}

function milestoneTime(iso: string | null, lang: Lang): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? formatJourneyTime(ms, lang) : null;
}

/**
 * Everything the journey card needs, in one place: where the truck is, how much of the corridor it has
 * covered, a pace-adjusted ETA, the three milestones and the cold-chain verdict. No network, no map tile.
 */
export function journeyPlan(shipment: ShipmentWithDetails, now: number, lang: Lang): JourneyPlan {
  const L = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  const progress = stopProgress(shipment.stops);
  const stops = progress.stops;
  const points = stops.map((stop) => ({ stop, fix: stopCoordinates(stop) }));

  // Planned distance and the share already behind each stop, so the rail is proportional to the road.
  const legs = points.slice(1).map((p, i) => legHours(points[i].fix, p.fix));

  const reachedIndexes = points.map((p, i) => (p.stop.reached_at ? i : -1)).filter((i) => i >= 0);
  const lastReachedIndex = reachedIndexes.length ? Math.max(...reachedIndexes) : -1;
  const nextIndex = points.findIndex((p) => !p.stop.reached_at);
  const nextStop = nextIndex >= 0 ? stops[nextIndex] : null;
  const destination = progress.destination;
  const origin = progress.origin;
  const current = progress.current;
  const fix = newestFix(shipment);
  const lastReachedMs = lastReachedIndex >= 0
    ? Date.parse(stops[lastReachedIndex].reached_at as string)
    : NaN;
  const lastReachedAt = Number.isFinite(lastReachedMs) ? lastReachedMs : null;
  const fixMs = fix ? Date.parse(fix.recorded_at) : NaN;
  // A driver can confirm arrival without a fresh location. If the newest fix predates that confirmation
  // by more than a few minutes, it describes a finished leg and must not override the confirmed stop.
  const fixIsFresh = !!fix && (
    lastReachedAt == null ||
    (Number.isFinite(fixMs) && fixMs >= lastReachedAt - FIX_FRESHNESS_MS)
  );
  const etaFix = fixIsFresh ? fix : null;

  const startMs = Date.parse(shipment.current_started_at ?? shipment.started_at ?? '');
  const start = Number.isFinite(startMs) ? startMs : null;
  const deliveredMs = shipment.delivered_at ? Date.parse(shipment.delivered_at) : null;
  // Planned hours up to the last confirmed stop, and the pace the driver is actually keeping.
  const plannedHoursToCurrent = lastReachedIndex > 0
    ? legs.slice(0, lastReachedIndex).reduce((a, b) => a + b, 0)
    : 0;
  // Pace is measured only to the last confirmation, never across the unfinished leg.
  const elapsedToLast = start && Number.isFinite(lastReachedMs) ? hoursBetween(start, lastReachedMs) : 0;
  const pace = plannedHoursToCurrent > 0 && elapsedToLast > 0
    ? clamp(elapsedToLast / plannedHoursToCurrent, 0.65, 2.1)
    : 1;
  // The remaining duration starts at the newest fix, so GPS progress shortens the ETA instead of being
  // counted twice. The whole last leg is only used when there is no fix at all.
  const lastReachedFixForEta = lastReachedIndex >= 0 ? points[lastReachedIndex].fix : null;
  const nextFixForEta = nextIndex >= 0 ? points[nextIndex].fix : null;
  const nextBaseForEta = etaFix ?? lastReachedFixForEta ?? points[0]?.fix ?? null;
  const remainingHours =
    (nextIndex >= 0 ? legHours(nextBaseForEta, nextFixForEta) : 0) +
    (nextIndex >= 0 ? legs.slice(nextIndex).reduce((a, b) => a + b, 0) : 0);

  let etaMs: number | null = null;
  if (shipment.status === 'delivered' && deliveredMs) etaMs = deliveredMs;
  else if (shipment.status === 'on_the_road') etaMs = now + remainingHours * pace * 3_600_000;
  else if (shipment.status === 'preparing') etaMs = start ? start + remainingHours * 3_600_000 : null;

  // Behind or ahead of the plan, from the last confirmed stop (or the delivery itself).
  let scheduleMs = 0;
  if (shipment.status === 'on_the_road' && lastReachedIndex > 0 && start) {
    const actualToStop = (Date.parse(stops[lastReachedIndex].reached_at as string) - start);
    const plannedToStop = plannedHoursToCurrent * 3_600_000;
    scheduleMs = actualToStop - plannedToStop;
  } else if (shipment.status === 'delivered' && deliveredMs && start) {
    scheduleMs = (deliveredMs - start) - legs.reduce((a, b) => a + b, 0) * 3_600_000;
  }
  const onSchedule = Math.abs(scheduleMs) <= SCHEDULE_TOLERANCE_MS;
  const scheduleTone: JourneyTone = shipment.status === 'delivered'
    ? 'ok'
    : shipment.status !== 'on_the_road'
      ? 'muted'
      : onSchedule ? 'ok' : scheduleMs > 0 ? 'warn' : 'ok';

  const etaConfidence: EtaConfidence = shipment.status === 'delivered'
    ? 'high'
    : reachedIndexes.length >= 3 ? 'high' : reachedIndexes.length >= 1 ? 'medium' : 'low';

  // Progress is the share of the route's stops confirmed, the same arithmetic the route list shows.
  const lastReachedFix = lastReachedIndex >= 0 ? points[lastReachedIndex].fix : null;
  const progressPct = shipment.status === 'delivered'
    ? 100
    : progress.total > 0 ? Math.round((progress.reachedCount / progress.total) * 100) : 0;

  const nextFix = nextIndex >= 0 ? points[nextIndex].fix : null;
  const nextBase = etaFix ?? lastReachedFix ?? points[0]?.fix ?? null;
  const distanceToNextKm = nextBase && nextFix ? Math.round(haversineKm(nextBase, nextFix)) : null;
  const nextEtaMs = shipment.status === 'on_the_road' && nextIndex >= 0
    ? now + legHours(nextBase, nextFix) * pace * 3_600_000
    : null;

  // Every stop gets a time: the actual arrival for a reached stop, the next stop's ETA, then each later
  // leg added from that ETA so the list adds up to the total trip ETA.
  const stopEtas: StopEta[] = [];
  let cursorMs = nextEtaMs;
  for (let i = 0; i < stops.length; i++) {
    const stop = stops[i];
    const point = points[i];
    const reached = !!stop.reached_at;
    const isNext = nextStop?.id === stop.id;
    let timeLabel: string | null = null;
    let stopEtaMs: number | null = null;
    let caption: string;
    let state: StopEta['state'];
    if (reached) {
      const parsed = Date.parse(stop.reached_at as string);
      stopEtaMs = Number.isFinite(parsed) ? parsed : null;
      timeLabel = milestoneTime(stop.reached_at, lang);
      caption = i === 0
        ? L('Departed', 'انطلقت')
        : destination?.id === stop.id
          ? L('Delivered', 'تم التسليم')
          : L('Arrived', 'وصلت');
      state = 'done';
    } else if (shipment.status === 'delivered') {
      caption = L('Delivered', 'تم التسليم');
      state = 'done';
    } else if (shipment.status === 'preparing') {
      caption = L('After departure', 'بعد الانطلاق');
      state = 'pending';
    } else if (isNext) {
      stopEtaMs = nextEtaMs;
      timeLabel = nextEtaMs ? relativeDayLabel(nextEtaMs, now, lang) : null;
      caption = L('Next stop · ETA', 'المحطة التالية · الوصول');
      state = 'next';
    } else if (cursorMs != null && i > 0) {
      const prevFix = points[i - 1]?.fix ?? null;
      cursorMs += legHours(prevFix, point.fix) * pace * 3_600_000;
      stopEtaMs = cursorMs;
      timeLabel = relativeDayLabel(cursorMs, now, lang);
      caption = L('Estimated arrival', 'الوصول المتوقع');
      state = 'later';
    } else {
      caption = L('No estimate yet', 'لا يوجد تقدير بعد');
      state = 'pending';
    }
    stopEtas.push({ id: stop.id, name: stopName(stop, lang), reached, next: isNext, state, timeLabel, etaMs: stopEtaMs, caption });
  }

  const plannedTotalMs = legs.reduce((a, b) => a + b, 0) * 3_600_000;
  const totalTripMs = shipment.status === 'delivered' && deliveredMs && start
    ? deliveredMs - start
    : shipment.status === 'on_the_road' && etaMs && start
      ? etaMs - start
      : shipment.status === 'preparing'
        ? plannedTotalMs
        : null;
  const remainingMs = shipment.status === 'on_the_road' && etaMs ? Math.max(0, etaMs - now) : null;
  const totalTripLabel = totalTripMs != null ? durationLabel(totalTripMs, lang) : '—';
  const remainingLabel = remainingMs != null
    ? durationLabel(remainingMs, lang)
    : shipment.status === 'delivered'
      ? L('Delivered', 'تم التسليم')
      : shipment.status === 'preparing'
        ? L('After departure', 'بعد الانطلاق')
        : '—';

  const cold = latestReading(shipment.readings);
  const alertCount = shipment.readings.filter((r) => r.is_alert).length;
  const inRangePct = shipment.readings.length
    ? Math.round(((shipment.readings.length - alertCount) / shipment.readings.length) * 100)
    : null;
  const coldChainTone: JourneyTone = !cold ? 'muted' : cold.is_alert ? 'bad' : 'ok';
  const coldChainLabel = !cold
    ? L('No temperature reading yet', 'لا توجد قراءة حرارة بعد')
    : cold.is_alert
      ? L('Cold chain alert', 'تنبيه سلسلة التبريد')
      : L('Cold chain intact', 'سلسلة التبريد سليمة');

  const corridorStops: CorridorStop[] = points.flatMap((p, i) => {
    if (!p.fix) return [];
    const { x, y } = projectCorridor(p.fix.longitude, p.fix.latitude);
    return [{
      id: p.stop.id,
      name: stopName(p.stop, lang),
      x,
      y,
      atPct: Math.round((i / Math.max(1, stops.length - 1)) * 100),
      reached: !!p.stop.reached_at,
      next: nextStop?.id === p.stop.id,
      destination: destination?.id === p.stop.id,
      kind: p.stop.kind,
    }];
  });

  // The truck sits at the freshest usable fix; if the newest fix predates the last confirmation,
  // it waits at the confirmed stop instead of showing an obsolete position.
  let truck: { x: number; y: number } | null = null;
  let truckAtStop = false;
  if (etaFix) {
    truck = projectCorridor(etaFix.longitude, etaFix.latitude);
  } else if (lastReachedFix) {
    truck = projectCorridor(lastReachedFix.longitude, lastReachedFix.latitude);
    truckAtStop = true;
  } else if (points[0]?.fix) {
    truck = projectCorridor(points[0].fix.longitude, points[0].fix.latitude);
    truckAtStop = true;
  }

  const status = statusCopy(shipment, lang, now, progress, etaFix);
  const etaLabel = etaMs
    ? (shipment.status === 'delivered' ? formatJourneyTime(etaMs, lang) : relativeDayLabel(etaMs, now, lang))
    : shipment.status === 'preparing'
      ? L('After departure', 'بعد الانطلاق')
      : L('Not available', 'غير متاح');
  const etaHint = shipment.status === 'delivered'
    ? L('Delivered', 'تم التسليم')
    : shipment.status === 'preparing'
      ? L('Starts when the driver accepts', 'يبدأ عند قبول السائق')
      : shipment.status === 'on_the_road'
        ? onSchedule
          ? L(`On schedule · ${Math.max(0, progress.total - progress.reachedCount)} stops left`, `حسب الجدول · ${Math.max(0, progress.total - progress.reachedCount)} محطات متبقية`)
          : scheduleMs > 0
            ? L(`${durationLabel(scheduleMs, lang)} behind`, `متأخر ${durationLabel(scheduleMs, lang)}`)
            : L(`${durationLabel(-scheduleMs, lang)} ahead`, `متقدم ${durationLabel(-scheduleMs, lang)}`)
        : L('Trip is not moving', 'الرحلة غير متحركة');

  const milestones: JourneyMilestone[] = [];
  if (origin) {
    milestones.push({
      key: 'origin', kind: 'origin', state: origin.reached_at ? 'done' : 'pending',
      name: stopName(origin, lang),
      caption: origin.reached_at
        ? L('Shipment set off', 'انطلقت الشحنة')
        : L('Departure point', 'نقطة الانطلاق'),
      time: milestoneTime(origin.reached_at, lang),
    });
  }
  const currentIndex = current ? stops.findIndex((s) => s.id === current.id) : -1;
  const previousStop = currentIndex > 0 ? stops[currentIndex - 1] : null;
  const waypoint = (() => {
    if (current && destination && current.id !== destination.id && (!nextStop || nextStop.id === destination.id)) {
      return { stop: current, state: 'done' as MilestoneState, label: L('Last confirmed', 'آخر تأكيد') };
    }
    if (nextStop && destination && nextStop.id !== destination.id && nextStop.id !== origin?.id) {
      return { stop: nextStop, state: 'next' as MilestoneState, label: L('Next stop', 'المحطة التالية') };
    }
    if (current && destination && current.id === destination.id && previousStop && previousStop.id !== origin?.id) {
      return { stop: previousStop, state: 'done' as MilestoneState, label: L('Last confirmed', 'آخر تأكيد') };
    }
    if (current && origin && destination && current.id !== origin.id && current.id !== destination.id) {
      return { stop: current, state: 'done' as MilestoneState, label: L('Last confirmed', 'آخر تأكيد') };
    }
    return null;
  })();
  if (waypoint) {
    const stop = waypoint.stop;
    const km = distanceToNextKm != null && waypoint.state === 'next' ? ` · ${distanceToNextKm} km` : '';
    milestones.push({
      key: 'waypoint', kind: 'waypoint', state: waypoint.state,
      name: stopName(stop, lang),
      caption: waypoint.state === 'next'
        ? `${waypoint.label}${km}`
        : waypoint.label,
      time: waypoint.state === 'next'
        ? (nextEtaMs ? relativeDayLabel(nextEtaMs, now, lang) : null)
        : milestoneTime(stop.reached_at, lang),
      actionable: waypoint.state === 'next',
    });
  } else {
    milestones.push({
      key: 'waypoint', kind: 'waypoint', state: 'pending',
      name: shipment.status === 'delivered'
        ? L('Completed', 'مكتملة')
        : shipment.status === 'preparing'
          ? L('Waiting to depart', 'بانتظار الانطلاق')
          : L('On hold', 'متوقفة'),
      caption: shipment.status === 'delivered'
        ? L('Trip closed', 'أُغلقت الرحلة')
        : shipment.status === 'preparing'
          ? L('The driver has not started yet', 'لم يبدأ السائق بعد')
          : L('No confirmed stop', 'لا توجد محطة مؤكدة'),
      time: null,
    });
  }
  if (destination) {
    const done = !!destination.reached_at || shipment.status === 'delivered';
    milestones.push({
      key: 'destination', kind: 'destination', state: done ? 'done' : nextStop?.id === destination.id ? 'next' : 'waiting',
      name: stopName(destination, lang),
      caption: done
        ? L('Delivered', 'تم التسليم')
        : nextStop?.id === destination.id
          ? L('Next stop · final delivery', 'المحطة التالية · التسليم النهائي')
          : L('Waiting to arrive', 'بانتظار الوصول'),
      time: done ? milestoneTime(destination.reached_at ?? shipment.delivered_at, lang) : etaMs ? relativeDayLabel(etaMs, now, lang) : null,
    });
  }

  const shareText = [
    `${shipment.reference} · ${shipment.cargo}`,
    `${status.statusNow} → ${destination ? stopName(destination, lang) : ''}`,
    `${progressPct}% · ${L('ETA', 'الوصول')} ${etaLabel}`,
    coldChainLabel,
  ].filter(Boolean).join(' · ');

  return {
    ...status,
    etaMs,
    nextEtaMs,
    etaLabel,
    etaHint,
    etaConfidence,
    scheduleTone,
    progressPct,
    reachedCount: progress.reachedCount,
    total: progress.total,
    remainingStops: Math.max(0, progress.total - progress.reachedCount),
    distanceToNextKm,
    nextStop,
    origin,
    destination,
    current,
    milestones,
    stopEtas,
    totalTripMs,
    totalTripLabel,
    remainingMs,
    remainingLabel,
    corridorStops,
    truck,
    truckAtStop,
    lastFixAt: fix?.recorded_at ?? null,
    fixFresh: fixIsFresh,
    coldChainLabel,
    coldChainTone,
    inRangePct,
    readingsCount: shipment.readings.length,
    alertCount,
    shareText,
  };
}
