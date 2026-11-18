import { ReadingFreshness } from './ReadingFreshness';
import { Ban, ChevronRight, MapPin, Scale, Thermometer, Timer, Trash2, Truck, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import { placeText } from '../geo';
import {
  agoLabel, attentionState, temperatureVerdict, durationLabel, latestReading, liveness, rangeScale, readingDue, stopName, stopProgress, STATUS_LABELS, STATUS_TAG, type Lang,
} from '../route';
import type { ShipmentStatus, ShipmentWithDetails } from '../types';

const temp = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

const KIND: Record<ShipmentStatus, string> = { preparing: 'prep', on_the_road: 'road', delivered: 'done', ended_early: 'prep', cancelled: 'void' };

/** The thermometer strip: the allowed band in green with its two limits and the target, the latest reading as a dot. */
export function RangeStrip({ temperature, target, tolerance, alert }: { temperature: number | null; target: number; tolerance: number; alert: boolean }) {
  const s = rangeScale(target, tolerance, temperature);
  const targetPct = ((target - s.min) / (s.max - s.min)) * 100;
  return (
    <>
      <div className="cs-range" aria-hidden="true">
        <span className="band" style={{ left: `${s.bandStartPct}%`, width: `${s.bandEndPct - s.bandStartPct}%` }} />
        <span className="tick" style={{ left: `${targetPct}%` }} />
        {s.markerPct !== null && <span className={cn('dot', alert && 'bad')} style={{ left: `${Math.min(100, Math.max(0, s.markerPct))}%` }} />}
      </div>
      <div className="cs-range-l" aria-hidden="true">
        <span style={{ left: `${s.bandStartPct}%` }}>{temp(s.bandLow)}°</span>
        <span className="t" style={{ left: `${targetPct}%` }}>{temp(target)}°</span>
        <span style={{ left: `${s.bandEndPct}%` }}>{temp(s.bandHigh)}°</span>
      </div>
    </>
  );
}

/** One plain sentence: right on target, or too warm / too cold by how many degrees, and what the limits are. */
export function TempVerdict({ temperature, target, tolerance, lang }: { temperature: number | null; target: number; tolerance: number; lang: Lang }) {
  const L = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  if (temperature == null) return <div className="cs-verdict mute">{L('No reading yet', 'لا توجد قراءة بعد')}</div>;
  const v = temperatureVerdict(temperature, target, tolerance);
  const limits = <span dir="ltr">{temp(v.low)}° … {temp(v.high)}°</span>;
  return (
    <div className={cn('cs-verdict', v.state === 'ok' ? 'ok' : 'bad')}>
      <b>
        {v.state === 'ok' && L('Within the allowed range', 'ضمن النطاق المسموح')}
        {v.state === 'warm' && <>{L('Too warm by', 'أدفأ من المسموح بـ')} <span dir="ltr">{temp(v.offBy)}°</span></>}
        {v.state === 'cold' && <>{L('Too cold by', 'أبرد من المسموح بـ')} <span dir="ltr">{temp(v.offBy)}°</span></>}
      </b>
      <span>{L('It must stay between', 'يجب أن تبقى بين')} {limits}</span>
    </div>
  );
}

/** The allowed band as one figure, with the target it is built from, so nobody has to add and subtract. */
export function TempLimits({ target, tolerance, lang }: { target: number; tolerance: number; lang: Lang }) {
  const L = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  return (
    <>
      <div className="k">{L('Must stay between', 'يجب أن تبقى بين')}</div>
      <div className="co-amt cs-temp"><small>°C</small><b>{temp(target - tolerance)}…{temp(target + tolerance)}</b></div>
      <div className="cs-state mute">{L(`Target ${temp(target)}° ± ${temp(tolerance)}°`, `المطلوب ${temp(target)}° ± ${temp(tolerance)}°`)}</div>
    </>
  );
}

/** A compact half-dial: the green band is the allowed range, the dot is the latest reading. */
function TempDial({ temperature, target, tolerance, alert }: { temperature: number | null; target: number; tolerance: number; alert: boolean }) {
  const s = rangeScale(target, tolerance, temperature);
  const pct = Math.min(100, Math.max(0, s.markerPct ?? 0));
  const cx = 62;
  const cy = 64;
  const r = 48;
  const polar = (value: number) => {
    const angle = Math.PI * (1 - value / 100);
    return [cx + r * Math.cos(angle), cy - r * Math.sin(angle)] as const;
  };
  const arc = (from: number, to: number) => {
    const [x1, y1] = polar(from);
    const [x2, y2] = polar(to);
    return `M ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2}`;
  };
  const [markerX, markerY] = polar(pct);
  const [targetX, targetY] = polar(((target - s.min) / Math.max(1e-9, s.max - s.min)) * 100);
  return (
    <div className="cs-dial" aria-hidden="true">
      <svg viewBox="0 0 124 76">
        <path className="track" d={arc(0, 100)} />
        <path className="band" d={arc(s.bandStartPct, s.bandEndPct)} />
        <line className="target" x1={targetX} y1={targetY - 4} x2={targetX} y2={targetY + 4} />
        {s.markerPct !== null && <circle className={cn('marker', alert && 'bad')} cx={markerX} cy={markerY} r="4.5" />}
      </svg>
      <div className="cs-dial-val"><b>{temperature == null ? '—' : temp(temperature)}</b><small>°C</small></div>
    </div>
  );
}

/** The last readings as a small trend line, so a drift is visible before the next photo. */
function TempSpark({ readings, target, tolerance }: { readings: ShipmentWithDetails['readings']; target: number; tolerance: number }) {
  const points = [...readings]
    .filter((r) => Number.isFinite(Number(r.temperature_c)))
    .sort((a, b) => new Date(a.taken_at).getTime() - new Date(b.taken_at).getTime())
    .slice(-8);
  if (points.length < 2) return null;
  const W = 150;
  const H = 34;
  const pad = 3;
  const temps = points.map((p) => Number(p.temperature_c));
  const lo = Math.min(...temps, target - tolerance) - 2;
  const hi = Math.max(...temps, target + tolerance) + 2;
  const y = (value: number) => pad + (1 - (value - lo) / Math.max(1e-9, hi - lo)) * (H - pad * 2);
  const x = (index: number) => pad + (index / Math.max(1, points.length - 1)) * (W - pad * 2);
  const line = points.map((p, i) => `${x(i).toFixed(1)},${y(Number(p.temperature_c)).toFixed(1)}`).join(' ');
  const bandTop = y(target + tolerance);
  const bandBottom = y(target - tolerance);
  return (
    <svg className="cs-spark" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Temperature trend">
      <rect className="band" x="0" y={bandTop} width={W} height={Math.max(0, bandBottom - bandTop)} />
      <polyline className="line" points={line} />
      {points.map((p, i) => (
        <circle key={p.id} className={cn('dot', p.is_alert && 'bad')} cx={x(i)} cy={y(Number(p.temperature_c))} r="2.2" />
      ))}
    </svg>
  );
}

/** A cancelled trip is a record, not a live card: muted, no route controls, with a delete action. */
function CancelledCard({ shipment, lang, now, onOpen, onDelete }: { shipment: ShipmentWithDetails; lang: Lang; now: number; onOpen: () => void; onDelete?: () => void }) {
  const L = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  const last = latestReading(shipment.readings);
  const date = new Date(shipment.started_at ?? shipment.created_at).toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-GB', { day: 'numeric', month: 'short' });
  return (
    <div
      role="button"
      tabIndex={0}
      className="co-card cs-card cancelled"
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
      aria-label={`${shipment.reference} — ${STATUS_LABELS.cancelled[lang]}`}
    >
      <div className="co-card-top">
        <span className="co-no">{shipment.reference}</span>
        <span className="cs-cargo">{shipment.cargo}</span>
        <span className="co-date" style={{ marginInlineStart: 'auto' }}>{date}</span>
        <span className="co-tag grey" style={{ marginInlineStart: 0 }}>{STATUS_LABELS.cancelled[lang]}</span>
      </div>
      <div className="cs-cancel-body">
        <span className="cs-cancel-ic"><Ban aria-hidden="true" /></span>
        <div>
          <b>{L('This trip was cancelled', 'أُلغيت هذه الرحلة')}</b>
          <p>{L('No new temperature or route updates are expected.', 'لا تُتوقع تحديثات حرارة أو مسار جديدة.')}</p>
          {last && <span>{L('Last reading', 'آخر قراءة')} <b dir="ltr">{temp(last.temperature_c)}°C</b> · {agoLabel(last.taken_at, now, lang)}</span>}
        </div>
      </div>
      <div className="cs-cancel-foot">
        <span>{L('No active monitoring', 'لا توجد متابعة نشطة')}</span>
        {onDelete && (
          <button type="button" className="cs-delete" onClick={(e) => { e.stopPropagation(); onDelete(); }}>
            <Trash2 aria-hidden="true" />{L('Delete', 'حذف')}
          </button>
        )}
      </div>
    </div>
  );
}

type ShipmentCardProps = { shipment: ShipmentWithDetails; lang: Lang; now: number; onOpen: () => void; onDelete?: () => void; audience?: 'customer' | 'driver' };

/**
 * One shipment as an order-style card: reference and status on top, the temperature now against what is
 * allowed, where the truck is, how far along the route it is, and when it was last heard from.
 */
export function ShipmentCard({ shipment, lang, now, onOpen, onDelete, audience = 'customer' }: ShipmentCardProps) {
  const L = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  if (shipment.status === 'cancelled') return <CancelledCard shipment={shipment} lang={lang} now={now} onOpen={onOpen} onDelete={onDelete} />;
  const last = latestReading(shipment.readings);
  const due = readingDue(shipment, last?.taken_at ?? null, now);
  const live = liveness(due);
  const attention = attentionState(shipment, last, now);
  const progress = stopProgress(shipment.stops);
  const area = placeText(shipment.locations[0], lang);
  const pct = progress.total ? Math.round((progress.reachedCount / progress.total) * 100) : 0;
  const alert = !!last?.is_alert;
  const kind = attention ? 'alert' : KIND[shipment.status];
  const tag = attention === 'alert' ? 'bad' : attention === 'overdue' ? 'warn' : STATUS_TAG[shipment.status];
  const tagLabel = attention === 'alert' ? L('Out of range', 'خارج النطاق') : attention === 'overdue' ? L('Reading overdue', 'القراءة متأخرة') : STATUS_LABELS[shipment.status][lang];
  const date = new Date(shipment.started_at ?? shipment.created_at).toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-GB', { day: 'numeric', month: 'short' });

  return (
    <div
      role="button"
      tabIndex={0}
      className={cn('co-card cs-card', kind)}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
      aria-label={`${shipment.reference} — ${tagLabel}`}
    >
      <div className="co-card-top">
        <span className="co-no">{shipment.reference}</span>
        <span className="cs-cargo">{shipment.cargo}</span>
        <span className="co-date" style={{ marginInlineStart: 'auto' }}>{date}</span>
        <span className={cn('co-tag', tag)} style={{ marginInlineStart: 0 }}>{tagLabel}</span>
      </div>

      <div className={cn('cs-temp-hero', alert && 'bad', !last && 'mute')}>
        <div className="cs-temp-hero-head">
          <div className="cs-temp-kicker"><Thermometer aria-hidden="true" />{L('Last recorded temperature', 'آخر حرارة مسجلة')}</div>
          <span className={cn('cs-temp-pill', alert ? 'bad' : last ? 'ok' : 'mute')}>
            {last ? (alert ? L('Out of range', 'خارج النطاق') : L('Within range', 'ضمن النطاق')) : L('Awaiting first reading', 'بانتظار أول قراءة')}
          </span>
        </div>
        <div className="cs-temp-hero-body">
          <TempDial temperature={last?.temperature_c ?? null} target={shipment.target_temp_c} tolerance={shipment.tolerance_c} alert={alert} />
          <div className="cs-temp-hero-copy">
            <TempLimits target={shipment.target_temp_c} tolerance={shipment.tolerance_c} lang={lang} />
            <ReadingFreshness takenAt={last?.taken_at ?? null} intervalHours={shipment.reading_interval_hours} active={shipment.status === 'on_the_road'} now={now} lang={lang} />
            {last && <TempSpark readings={shipment.readings} target={shipment.target_temp_c} tolerance={shipment.tolerance_c} />}
          </div>
        </div>
      </div>

      <div className="cs-chips">
        {audience === 'customer' && shipment.driver && <span className="co-rate"><User style={{ width: 11, height: 11 }} aria-hidden="true" /> <b dir="auto">{shipment.driver.display_name}</b></span>}
        {shipment.weight_tons != null && <span className="co-rate"><Scale style={{ width: 11, height: 11 }} aria-hidden="true" /> <b>{shipment.weight_tons} t</b></span>}
        {audience === 'customer' && !shipment.driver && <span className="co-rate">{L('No driver assigned', 'لم يُعيَّن سائق')}</span>}
        {audience === 'driver' && due.dueAt != null && (
          <span className="co-rate" style={due.state === 'overdue' ? { color: '#f0245b' } : undefined}>
            <Timer style={{ width: 11, height: 11 }} aria-hidden="true" />{' '}
            <b>{due.state === 'overdue' ? L(`Reading overdue ${durationLabel(due.overdueMs, lang)}`, `القراءة متأخرة ${durationLabel(due.overdueMs, lang)}`) : L(`Next reading in ${durationLabel(due.dueAt - now, lang)}`, `القراءة القادمة بعد ${durationLabel(due.dueAt - now, lang)}`)}</b>
          </span>
        )}
      </div>

      {shipment.status === 'on_the_road' && (
        <div className="cs-where">
          <MapPin aria-hidden="true" />
          <div>{L('Last known location', 'آخر موقع معروف')} <b>{area ?? (shipment.locations[0] ? L('Area name unavailable', 'اسم المنطقة غير متاح') : L('No location recorded yet', 'لم يُسجل موقع بعد'))}</b></div>
          {shipment.locations[0] && <span>{agoLabel(shipment.locations[0].recorded_at, now, lang)}</span>}
        </div>
      )}

      <div className="cs-steps">
        <span className="lbl"><Truck style={{ width: 12, height: 12, verticalAlign: '-2px' }} aria-hidden="true" /> {L('Route', 'المسار')}</span>
        <div className="co-track" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.reachedCount}><i style={{ width: `${shipment.status === 'delivered' ? 100 : pct}%` }} /></div>
        <b className="co-pct ok" style={{ background: 'transparent', direction: 'ltr' }}>{progress.reachedCount}/{progress.total}</b>
      </div>
      {shipment.status === 'on_the_road' && progress.next && (
        <div className="cs-next">{L('Next stop', 'المحطة التالية')}: <b>{stopName(progress.next, lang)}</b></div>
      )}

      <div className="cs-foot">
        <span className={cn('cs-live', live === 'live' && 'live', live === 'stale' && 'stale')}>
          <i aria-hidden="true" />
          {last ? L(`Last reading ${agoLabel(last.taken_at, now, lang)}`, `آخر قراءة ${agoLabel(last.taken_at, now, lang)}`) : L('No reading yet', 'لا توجد قراءة بعد')}
        </span>
        <span className="cs-go">{audience === 'driver' ? L('Open', 'فتح') : L('Follow', 'تابع')}<ChevronRight aria-hidden="true" /></span>
      </div>
    </div>
  );
}
