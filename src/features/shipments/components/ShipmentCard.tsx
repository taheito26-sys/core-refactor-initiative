import { ChevronRight, MapPin, Scale, Truck, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import { placeText } from '../geo';
import {
  agoLabel, attentionState, latestReading, liveness, rangeScale, readingDue, stopName, stopProgress, STATUS_LABELS, STATUS_TAG, type Lang,
} from '../route';
import type { ShipmentStatus, ShipmentWithDetails } from '../types';

const temp = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

const KIND: Record<ShipmentStatus, string> = { preparing: 'prep', on_the_road: 'road', delivered: 'done', cancelled: 'void' };

/** The thermometer strip: the allowed band in green, the latest reading as a dot. */
export function RangeStrip({ temperature, target, tolerance, alert }: { temperature: number | null; target: number; tolerance: number; alert: boolean }) {
  const s = rangeScale(target, tolerance, temperature);
  return (
    <>
      <div className="cs-range" aria-hidden="true">
        <span className="band" style={{ left: `${s.bandStartPct}%`, width: `${s.bandEndPct - s.bandStartPct}%` }} />
        {s.markerPct !== null && <span className={cn('dot', alert && 'bad')} style={{ left: `${Math.min(100, Math.max(0, s.markerPct))}%` }} />}
      </div>
      <div className="cs-range-l" aria-hidden="true">
        <span style={{ left: `${s.bandStartPct}%` }}>{temp(s.bandLow)}°</span>
        <span style={{ left: `${s.bandEndPct}%` }}>{temp(s.bandHigh)}°</span>
      </div>
    </>
  );
}

/**
 * One shipment as an order-style card: reference and status on top, the temperature now against what is
 * allowed, where the truck is, how far along the route it is, and when it was last heard from.
 */
export function ShipmentCard({ shipment, lang, now, onOpen }: { shipment: ShipmentWithDetails; lang: Lang; now: number; onOpen: () => void }) {
  const L = (en: string, ar: string) => (lang === 'ar' ? ar : en);
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

      <div className="co-card-mid">
        <div className="co-amt-col">
          <div className="k">{L('Temperature now', 'الحرارة الآن')}</div>
          <div className={cn('co-amt cs-temp', alert && 'bad')}><small>°C</small><b>{last ? temp(last.temperature_c) : '—'}</b></div>
          {last && <div className={cn('cs-state', alert ? 'bad' : 'ok')}>{alert ? L('Out of range', 'خارج النطاق') : L('In range', 'ضمن النطاق')}</div>}
        </div>
        <div className="co-amt-col end">
          <div className="k">{L('Target', 'المطلوب')}</div>
          <div className="co-amt cs-temp"><small>±{shipment.tolerance_c}</small><b>{temp(shipment.target_temp_c)}</b></div>
          <div className="cs-state mute">{L('allowed', 'النطاق المسموح')}</div>
        </div>
      </div>
      <RangeStrip temperature={last?.temperature_c ?? null} target={shipment.target_temp_c} tolerance={shipment.tolerance_c} alert={alert} />

      <div className="cs-chips">
        {shipment.driver && <span className="co-rate"><User style={{ width: 11, height: 11 }} aria-hidden="true" /> <b dir="auto">{shipment.driver.display_name}</b></span>}
        {shipment.weight_tons != null && <span className="co-rate"><Scale style={{ width: 11, height: 11 }} aria-hidden="true" /> <b>{shipment.weight_tons} t</b></span>}
        {!shipment.driver && <span className="co-rate">{L('No driver assigned', 'لم يُعيَّن سائق')}</span>}
      </div>

      {shipment.status === 'on_the_road' && (
        <div className="cs-where">
          <MapPin aria-hidden="true" />
          <div>{L('Truck is in', 'الشاحنة في')} <b>{area ?? L('—', '—')}</b></div>
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
        <span className="cs-go">{L('Follow', 'تابع')}<ChevronRight aria-hidden="true" /></span>
      </div>
    </div>
  );
}
