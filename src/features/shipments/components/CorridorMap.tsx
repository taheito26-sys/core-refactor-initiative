import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Play, RotateCcw, Thermometer, Truck } from 'lucide-react';
import { CORRIDOR_COUNTRIES, CORRIDOR_VIEWBOX, projectCorridor } from '../corridor-geo';
import type { CorridorStop, JourneyTone } from '../journey-pulse';
import type { Lang } from '../route';

const LABELS: { key: string; lon: number; lat: number; en: string; ar: string; kind: 'country' | 'sea'; rotate?: number }[] = [
  { key: 'egypt', lon: 29.7, lat: 27.0, en: 'Egypt', ar: 'مصر', kind: 'country' },
  { key: 'saudi', lon: 43.6, lat: 24.1, en: 'Saudi Arabia', ar: 'السعودية', kind: 'country' },
  { key: 'qatar', lon: 50.9, lat: 26.3, en: 'Qatar', ar: 'قطر', kind: 'country' },
  { key: 'red-sea', lon: 35.2, lat: 24.6, en: 'Red Sea', ar: 'البحر الأحمر', kind: 'sea', rotate: 63 },
];

const polyline = (points: { x: number; y: number }[]) =>
  points.length < 2 ? '' : `M${points.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' L')}`;

/**
 * The corridor at a glance: the real Egypt → Saudi Arabia → Qatar coastline, the road already covered,
 * the dotted road ahead, and the truck exactly where the last fix put it. Pure SVG, no tiles, no keys.
 */
export function CorridorMap({
  stops, truck, truckAtStop, lang, tone, live, lastFixLabel, coldLabel, coldTone,
}: {
  stops: CorridorStop[];
  truck: { x: number; y: number } | null;
  truckAtStop: boolean;
  lang: Lang;
  tone: JourneyTone;
  live: boolean;
  lastFixLabel: string | null;
  coldLabel: string;
  coldTone: JourneyTone;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const seaId = `jp-sea-${uid}`;
  const landId = `jp-land-${uid}`;
  const glowId = `jp-glow-${uid}`;
  const traveledRef = useRef<SVGPathElement | null>(null);
  const [replay, setReplay] = useState(false);
  const [replayPoint, setReplayPoint] = useState<{ x: number; y: number } | null>(null);
  const frame = useRef<number | null>(null);

  const reached = stops.filter((s) => s.reached);
  const first = stops[0] ?? null;
  const lastReached = reached[reached.length - 1] ?? null;
  const ahead = stops.filter((s) => !s.reached);

  const traveledPoints = useMemo(() => {
    const pts = reached.map(({ x, y }) => ({ x, y }));
    if (truck && !truckAtStop && pts.length) pts.push(truck);
    return pts;
  }, [reached, truck, truckAtStop]);

  const remainingPoints = useMemo(() => {
    const start = truck ?? lastReached ?? first;
    const pts = start ? [{ x: start.x, y: start.y }] : [];
    ahead.forEach((s) => pts.push({ x: s.x, y: s.y }));
    return pts;
  }, [ahead, first, lastReached, truck]);

  const traveledD = polyline(traveledPoints);
  const remainingD = polyline(remainingPoints);

  useEffect(() => () => { if (frame.current) cancelAnimationFrame(frame.current); }, []);

  const replayTrip = () => {
    const path = traveledRef.current;
    if (!path || replay) return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const length = path.getTotalLength();
    if (!length) return;
    if (reduced) {
      const end = path.getPointAtLength(length);
      setReplayPoint({ x: end.x, y: end.y });
      window.setTimeout(() => setReplayPoint(null), 900);
      return;
    }
    const started = performance.now();
    setReplay(true);
    const step = (now: number) => {
      const t = Math.min(1, (now - started) / 2600);
      const eased = 1 - (1 - t) ** 3;
      const p = path.getPointAtLength(length * eased);
      setReplayPoint({ x: p.x, y: p.y });
      if (t < 1) frame.current = requestAnimationFrame(step);
      else {
        setReplay(false);
        window.setTimeout(() => setReplayPoint(null), 650);
      }
    };
    frame.current = requestAnimationFrame(step);
  };

  const liveLabel = lang === 'ar' ? 'مباشر' : 'Live';
  const mapLabel = lang === 'ar'
    ? `خريطة المسار من ${first?.name ?? ''} إلى ${stops[stops.length - 1]?.name ?? ''}`
    : `Route map from ${first?.name ?? ''} to ${stops[stops.length - 1]?.name ?? ''}`;

  return (
    <div className="jp-map" dir="ltr">
      <svg viewBox={CORRIDOR_VIEWBOX} className="jp-map-svg" role="img" aria-label={mapLabel} preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id={seaId} x1="0" y1="0" x2="0.7" y2="1">
            <stop offset="0" stopColor="#e7f3fc" />
            <stop offset="0.55" stopColor="#dcecf8" />
            <stop offset="1" stopColor="#d4e7f5" />
          </linearGradient>
          <linearGradient id={landId} x1="0" y1="0" x2="0.4" y2="1">
            <stop offset="0" stopColor="#fbf9fe" />
            <stop offset="1" stopColor="#f3effa" />
          </linearGradient>
          <filter id={glowId} x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="2.6" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <pattern id={`jp-grid-${uid}`} width="34" height="34" patternUnits="userSpaceOnUse">
            <path d="M34 0H0V34" fill="none" stroke="#ffffff" strokeOpacity=".42" strokeWidth=".7" />
          </pattern>
        </defs>

        <rect width="760" height="360" fill={`url(#${seaId})`} />
        <rect width="760" height="360" fill={`url(#jp-grid-${uid})`} />

        <g className="jp-land">
          {CORRIDOR_COUNTRIES.map((country) => (
            <g key={country.id}>
              {country.paths.map((d, i) => (
                <path key={i} d={d} fill={`url(#${landId})`} stroke="#ded7ee" strokeWidth="1" strokeLinejoin="round" />
              ))}
            </g>
          ))}
        </g>

        {LABELS.map((label) => {
          const { x, y } = projectCorridor(label.lon, label.lat);
          const text = lang === 'ar' ? label.ar : label.en;
          return (
            <text
              key={label.key}
              x={x}
              y={y}
              className={label.kind === 'sea' ? 'jp-map-sea-label' : 'jp-map-country-label'}
              textAnchor="middle"
              transform={label.rotate ? `rotate(${label.rotate} ${x} ${y})` : undefined}
            >
              {text}
            </text>
          );
        })}

        {remainingD && (
          <path d={remainingD} fill="none" stroke="#93a8d4" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="1 8" className="jp-route-ahead" />
        )}
        {traveledD && (
          <>
            <path d={traveledD} fill="none" stroke="#ffffff" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" opacity=".65" />
            <path ref={traveledRef} d={traveledD} fill="none" stroke={tone === 'bad' ? '#e11d48' : '#1e3a8a'} strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" filter={`url(#${glowId})`} pathLength={1} className="jp-route-done" />
          </>
        )}

        {stops.map((s) => (
          <g key={s.id} className={`jp-node ${s.reached ? 'done' : s.next ? 'next' : 'waiting'} ${s.destination ? 'dest' : ''}`} transform={`translate(${s.x.toFixed(1)} ${s.y.toFixed(1)})`}>
            {s.next && <circle r="11" className="jp-node-halo" />}
            {s.destination && !s.reached ? (
              <rect x="-6" y="-6" width="12" height="12" rx="3.5" fill="#fff" stroke="#1e3a8a" strokeWidth="2.6" />
            ) : (
              <circle r={s.reached ? 5.4 : 6} fill={s.reached ? '#1e3a8a' : '#fff'} stroke={s.reached ? '#fff' : '#1e3a8a'} strokeWidth={s.reached ? 2.4 : 2.6} />
            )}
            {s.reached && <circle r="1.8" fill="#fff" />}
            {s.next && <circle r="2.4" fill="#1e3a8a" />}
          </g>
        ))}

        {truck && (
          <g className={`jp-truck ${live ? 'live' : ''}`} transform={`translate(${truck.x.toFixed(1)} ${truck.y.toFixed(1)})`}>
            <circle r="16" className="jp-truck-pulse" />
            <circle r="11.5" fill="#0f1f5e" stroke="#fff" strokeWidth="2.4" />
            <Truck x={-7.2} y={-7.2} width={14.4} height={14.4} color="#fff" strokeWidth={2.2} aria-hidden="true" />
          </g>
        )}

        {replayPoint && (
          <g className="jp-replay-dot" transform={`translate(${replayPoint.x.toFixed(1)} ${replayPoint.y.toFixed(1)})`}>
            <circle r="10" fill="#ffffff" fillOpacity=".35" />
            <circle r="5.2" fill="#fff" stroke="#1e3a8a" strokeWidth="2.6" />
          </g>
        )}

        <g className="jp-scale" transform="translate(20 322)" aria-hidden="true">
          <path d="M0 0 H129" stroke="#5b6f9e" strokeWidth="1.6" strokeLinecap="round" />
          <path d="M0 -3 V3 M64.5 -3 V3 M129 -3 V3" stroke="#5b6f9e" strokeWidth="1.2" />
          <text x="64.5" y="-6" textAnchor="middle" className="jp-map-scale-label">{lang === 'ar' ? '500 كم' : '500 km'}</text>
        </g>
      </svg>

      <div className="jp-map-chips">
        <span className={`jp-map-chip ${live ? 'live' : ''}`}>
          <i aria-hidden="true" />
          {live ? liveLabel : (lastFixLabel ?? (lang === 'ar' ? 'بانتظار الإشارة' : 'Awaiting signal'))}
        </span>
        <span className={`jp-map-chip cold ${coldTone}`}>
          <Thermometer aria-hidden="true" />
          {coldLabel}
        </span>
      </div>

      <button type="button" className="jp-replay" onClick={replayTrip} disabled={!traveledD || replay} aria-label={lang === 'ar' ? 'إعادة تشغيل الرحلة' : 'Replay the trip'}>
        {replay ? <RotateCcw className="jp-spin" aria-hidden="true" /> : <Play aria-hidden="true" />}
        <span>{lang === 'ar' ? 'إعادة' : 'Replay'}</span>
      </button>
    </div>
  );
}
