import { useMemo, useState } from 'react';
import { Box, CheckCircle2, MapPin, Route as RouteIcon, Satellite, Thermometer } from 'lucide-react';
import { agoLabel, latestReading, stopName, stopProgress, STATUS_LABELS, type Lang } from '../route';
import { dayPartLabel, estimateArrival, fitTrail, journeyPercent, MAP_ROUTE, spreadAlong } from '../journey';
import type { ShipmentWithDetails } from '../types';

/**
 * The trip at a glance: where it is now, when it should arrive, how far along it is, a small map of the route
 * with the truck on it (ringed green while the cargo is in range, red when it is not), and the last, next and final stop.
 */
export function JourneyPanel({ shipment, lang, now }: { shipment: ShipmentWithDetails; lang: Lang; now: number }) {
  const L = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  const [view, setView] = useState<'route' | 'trail'>('route');
  // Real positions: the stops that carry coordinates, then every position the driver's phone reported, oldest first.
  const trail = useMemo(() => {
    const crumbs = [...shipment.locations].sort((a, b) => Date.parse(a.recorded_at) - Date.parse(b.recorded_at));
    const stopPts = shipment.stops.filter(s => s.latitude != null && s.longitude != null).map(s => ({ latitude: s.latitude as number, longitude: s.longitude as number, kind: 'stop' as const, reached: !!s.reached_at, label: stopName(s, lang) }));
    const all = [...stopPts, ...crumbs.map(c => ({ latitude: c.latitude, longitude: c.longitude, kind: 'crumb' as const, reached: true, label: '' }))];
    const fitted = fitTrail(all, 300, 180);
    return fitted ? { stops: fitted.filter(q => q.kind === 'stop'), crumbs: fitted.filter(q => q.kind === 'crumb') } : null;
  }, [shipment.locations, shipment.stops, lang]);
  const p = useMemo(() => stopProgress(shipment.stops), [shipment.stops]);
  const delivered = shipment.status === 'delivered';
  const pct = journeyPercent(p, delivered);
  const eta = estimateArrival(shipment, shipment.stops, now);
  const reading = latestReading(shipment.readings);
  const alert = !!reading?.is_alert;
  const pts = useMemo(() => spreadAlong(MAP_ROUTE, Math.max(p.total, 2)), [p.total]);
  const at = Math.max(0, p.reachedCount - 1);
  const done = pts.slice(0, p.reachedCount > 0 ? at + 1 : 0);
  const rest = pts.slice(p.reachedCount > 0 ? at : 0);
  const line = (a: { x: number; y: number }[]) => a.map(q => `${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(' ');
  const truck = p.reachedCount > 0 ? pts[at] : null;

  const nowText = delivered ? L('Delivered', 'تم التسليم')
    : p.current ? stopName(p.current, lang) : STATUS_LABELS[shipment.status][lang];
  const etaText = delivered ? (shipment.delivered_at ? dayPartLabel(Date.parse(shipment.delivered_at), lang) : '—')
    : eta ? dayPartLabel(eta.at, lang) : L('Not known yet', 'غير معروف بعد');

  const stopCard = (kind: 'last' | 'next' | 'end') => {
    const stop = kind === 'last' ? p.current : kind === 'next' ? p.next : p.destination;
    const Icon = kind === 'last' ? CheckCircle2 : kind === 'next' ? MapPin : Box;
    const sub = kind === 'last'
      ? (p.current?.reached_at ? agoLabel(p.current.reached_at, now, lang) : L('Not started', 'لم تبدأ'))
      : kind === 'next' ? (p.next ? L('Next stop', 'المحطة التالية') : L('All stops reached', 'تم الوصول لكل المحطات'))
      : (delivered ? L('Delivered', 'تم التسليم') : L('Waiting to arrive', 'بانتظار الوصول'));
    return (
      <div className={`jp-stop ${kind}${kind === 'end' && !delivered ? ' wait' : ''}`}>
        <Icon aria-hidden="true" />
        <b>{stop ? stopName(stop, lang) : '—'}</b>
        <small>{sub}</small>
      </div>
    );
  };

  return (
    <section className="ch-card cs-box jp" aria-label={L('Journey', 'الرحلة')}>
      <div className="jp-tiles">
        <div><small>{L('Status now', 'الحالة الآن')}</small><b>{nowText}</b></div>
        <div>
          <small>{L('Expected arrival', 'الوصول المتوقع')}</small>
          <b>{etaText}</b>
          {eta?.slow && <em className="slow">{L('Slower than its pace so far', 'أبطأ من وتيرته حتى الآن')}</em>}
        </div>
        <div><small>{L('Progress', 'التقدم')}</small><b dir="ltr">{pct}%</b></div>
      </div>
      <div className="jp-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${pct}%` }} /></div>

      {trail && (
        <div className="jp-switch" role="tablist" aria-label={L('Map view', 'عرض الخريطة')}>
          <button type="button" role="tab" aria-selected={view === 'route'} className={view === 'route' ? 'on' : ''} onClick={() => setView('route')}><RouteIcon aria-hidden="true" />{L('Route', 'المسار')}</button>
          <button type="button" role="tab" aria-selected={view === 'trail'} className={view === 'trail' ? 'on' : ''} onClick={() => setView('trail')}><Satellite aria-hidden="true" />{L('Live trail', 'المسار الفعلي')}</button>
        </div>
      )}
      {trail && view === 'trail' ? (
        <svg className="jp-map" viewBox="0 0 300 180" role="img" aria-label={L('Live trail from GPS', 'المسار الفعلي من الـ GPS')} dir="ltr">
          <rect width="300" height="180" rx="14" className="sea" />
          {trail.stops.length > 1 && <polyline points={line(trail.stops)} className="ahead" />}
          {trail.crumbs.length > 1 && <polyline points={line(trail.crumbs)} className="past" />}
          {trail.stops.map((q, i) => (
            <g key={i}>
              <circle cx={q.x} cy={q.y} r="3.6" className={q.reached ? 'stop on' : 'stop'} />
              {(i === trail.stops.length - 1 || i === trail.stops.findIndex(z => !z.reached) || i === trail.stops.filter(z => z.reached).length - 1) && <text x={q.x} y={q.y - 7} textAnchor="middle" className="lbl s">{q.label}</text>}
            </g>
          ))}
          {trail.crumbs.length > 0 && (() => { const c = trail.crumbs[trail.crumbs.length - 1]; return (
            <g><circle cx={c.x} cy={c.y} r="9" className={`halo${alert ? ' bad' : ''}`} /><circle cx={c.x} cy={c.y} r="5" className={`truck${alert ? ' bad' : ''}`} /></g>
          ); })()}
        </svg>
      ) : (
      <svg className="jp-map" viewBox="0 0 300 180" role="img" aria-label={L('Route map', 'خريطة المسار')} dir="ltr">
        <rect width="300" height="180" rx="14" className="sea" />
        <polygon className="land" points="14,100 58,70 104,76 118,104 96,160 20,162" />
        <polygon className="land" points="108,74 168,38 214,30 236,58 244,120 214,150 130,152 112,104" />
        <polygon className="land q" points="252,86 266,80 272,100 262,116 250,108" />
        <text x="30" y="156" className="lbl">{L('Egypt', 'مصر')}</text>
        <text x="150" y="130" className="lbl">{L('Saudi Arabia', 'السعودية')}</text>
        <text x="248" y="76" className="lbl q">{L('Qatar', 'قطر')}</text>
        <text x="96" y="58" className="lbl s">{L('Red Sea', 'البحر الأحمر')}</text>
        <polyline points={line(rest)} className="ahead" />
        {done.length > 1 && <polyline points={line(done)} className="past" />}
        {pts.map((q, i) => <circle key={i} cx={q.x} cy={q.y} r="3.4" className={i < p.reachedCount ? 'stop on' : 'stop'} />)}
        {truck && !delivered && (
          <g>
            <circle cx={truck.x} cy={truck.y} r="9" className={`halo${alert ? ' bad' : ''}`} />
            <circle cx={truck.x} cy={truck.y} r="5" className={`truck${alert ? ' bad' : ''}`} />
          </g>
        )}
      </svg>
      )}
      {reading && !delivered && (
        <div className={`jp-temp${alert ? ' bad' : ''}`}>
          <Thermometer aria-hidden="true" />
          <b dir="ltr">{Number.isInteger(reading.temperature_c) ? reading.temperature_c : reading.temperature_c.toFixed(1)}°C</b>
          <span>{alert ? L('Out of range', 'خارج النطاق') : L('In range', 'ضمن النطاق')} · {agoLabel(reading.taken_at, now, lang)}</span>
        </div>
      )}

      <div className="jp-stops">{stopCard('last')}{stopCard('next')}{stopCard('end')}</div>
    </section>
  );
}
