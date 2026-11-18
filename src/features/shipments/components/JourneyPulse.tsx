import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  Check, ChevronRight, CircleCheck, Clock3, Copy, Flag, MapPin, Package, Radio, Share2, Thermometer, Truck,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  journeyPlan, type JourneyAudience, type JourneyMilestone, type JourneyTone,
} from '../journey-pulse';
import { agoLabel, type Lang } from '../route';
import type { ShipmentWithDetails } from '../types';
import { CorridorMap } from './CorridorMap';

const TONE_ICON: Record<JourneyMilestone['state'], typeof Check> = {
  done: CircleCheck,
  next: MapPin,
  waiting: Package,
  pending: Clock3,
};

function Confidence({ level, lang }: { level: 'high' | 'medium' | 'low'; lang: Lang }) {
  const filled = level === 'high' ? 3 : level === 'medium' ? 2 : 1;
  const label = lang === 'ar'
    ? `ثقة الوصول: ${level === 'high' ? 'عالية' : level === 'medium' ? 'متوسطة' : 'مبدئية'}`
    : `ETA confidence: ${level}`;
  return (
    <span className="jp-confidence" role="img" aria-label={label} title={label}>
      {[0, 1, 2].map((i) => <i key={i} className={i < filled ? 'on' : ''} aria-hidden="true" />)}
    </span>
  );
}

function MilestoneCard({ m, lang }: { m: JourneyMilestone; lang: Lang }) {
  const Icon = TONE_ICON[m.state];
  const kicker = m.key === 'origin'
    ? (lang === 'ar' ? 'الانطلاق' : 'Origin')
    : m.key === 'destination'
      ? (lang === 'ar' ? 'الوجهة' : 'Destination')
      : m.state === 'pending'
        ? (lang === 'ar' ? 'الانطلاق' : 'Departure')
      : m.state === 'next'
        ? (lang === 'ar' ? 'المحطة التالية' : 'Next stop')
        : (lang === 'ar' ? 'آخر تأكيد' : 'Last confirmed');
  return (
    <li className={cn('jp-ms', m.state, m.key)} aria-current={m.state === 'next' ? 'step' : undefined}>
      <span className="jp-ms-ic" aria-hidden="true"><Icon /></span>
      <div className="jp-ms-body">
        <span className="jp-ms-kicker">{kicker}</span>
        <span className="jp-ms-name">{m.name}</span>
        <span className="jp-ms-caption">{m.caption}</span>
      </div>
      {m.time && <span className="jp-ms-time" dir="auto">{m.time}</span>}
    </li>
  );
}

/**
 * One live journey card shared by both sides of the shipment: three plain answers (where, when, how far),
 * a proportional progress rail, the geographic corridor, and three milestones. The driver gets the next
 * action; the customer gets a shareable update. It reads as one component, but each audience sees its own.
 */
export function JourneyPulse({
  shipment, lang, now, audience, onArrive,
}: {
  shipment: ShipmentWithDetails;
  lang: Lang;
  now: number;
  audience: JourneyAudience;
  /** The driver's "I reached this stop" action, wired to the existing arrival dialog. */
  onArrive?: () => void;
}) {
  const L = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  const plan = useMemo(() => journeyPlan(shipment, now, lang), [shipment, now, lang]);
  const [copied, setCopied] = useState(false);
  const fixAge = plan.lastFixAt ? now - Date.parse(plan.lastFixAt) : null;
  const live = shipment.status === 'on_the_road' && fixAge != null && fixAge < 30 * 60_000;
  const lastFixLabel = plan.lastFixAt ? agoLabel(plan.lastFixAt, now, lang) : null;

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 2400);
    return () => window.clearTimeout(t);
  }, [copied]);

  const share = async (mode: 'share' | 'copy' = 'share') => {
    const text = `${plan.shareText}\n${window.location.origin}/c/shipments`;
    try {
      if (mode === 'share' && navigator.share) {
        await navigator.share({ title: shipment.reference, text });
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        toast.success(L('Trip update copied', 'تم نسخ تحديث الرحلة'));
      } else {
        const area = document.createElement('textarea');
        area.value = text;
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        document.execCommand('copy');
        area.remove();
        setCopied(true);
        toast.success(L('Trip update copied', 'تم نسخ تحديث الرحلة'));
      }
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') return;
      toast.error(L('Could not copy the update', 'تعذر نسخ التحديث'));
    }
  };

  const toneClass: Record<JourneyTone, string> = { live: 'live', ok: 'ok', warn: 'warn', bad: 'bad', muted: 'muted' };
  const nextKm = plan.distanceToNextKm != null ? `${plan.distanceToNextKm} km` : null;
  const journeyKicker = shipment.status === 'delivered'
    ? L('Journey complete', 'رحلة مكتملة')
    : shipment.status === 'on_the_road'
      ? L('Live journey', 'نبض الرحلة')
      : L('Journey', 'الرحلة');
  const idleState = shipment.status === 'delivered'
    ? { icon: CircleCheck, label: L('Completed', 'مكتملة') }
    : shipment.status === 'on_the_road'
      ? { icon: CircleCheck, label: L('All stops reached', 'تم الوصول لكل المحطات') }
      : shipment.status === 'ended_early'
        ? { icon: Clock3, label: L('Paused', 'متوقفة') }
        : { icon: Truck, label: L('Not started', 'لم تبدأ') };
  const IdleIcon = idleState.icon;

  return (
    <section dir={lang === 'ar' ? 'rtl' : 'ltr'} className={cn('jp-card', `tone-${toneClass[plan.statusTone]}`, plan.coldChainTone === 'bad' && 'cold-bad')} aria-label={`${L('Journey', 'الرحلة')} ${shipment.reference}`}>
      <header className="jp-head">
        <div className="jp-title">
          <span className="jp-kicker"><Radio aria-hidden="true" />{journeyKicker}<span className={cn('jp-dot', shipment.status !== 'on_the_road' && 'idle')} aria-hidden="true" /></span>
          <span className="jp-ref">{shipment.reference}<span className="jp-sep">·</span>{shipment.cargo}</span>
        </div>
        {audience === 'customer' && (
          <button type="button" className={cn('jp-share', copied && 'done')} onClick={() => share('share')}>
            {copied ? <Check aria-hidden="true" /> : <Share2 aria-hidden="true" />}
            <span>{copied ? L('Copied', 'تم النسخ') : L('Share', 'مشاركة')}</span>
          </button>
        )}
      </header>

      <div className="jp-stats">
        <div className="jp-stat">
          <span className="jp-stat-l">{L('Status now', 'الحالة الآن')}</span>
          <span className="jp-stat-v">{plan.statusNow}</span>
          <span className={cn('jp-stat-h', plan.statusTone)}>{plan.statusHint}</span>
        </div>
        <div className="jp-stat">
          <span className="jp-stat-l">{shipment.status === 'delivered' ? L('Delivered at', 'وقت التسليم') : L('Expected arrival', 'الوصول')}</span>
          <span className="jp-stat-v jp-eta" dir="auto">{plan.etaLabel}</span>
          <span className={cn('jp-stat-h eta', plan.scheduleTone)}>
            {plan.etaHint}
            {shipment.status === 'on_the_road' && <Confidence level={plan.etaConfidence} lang={lang} />}
          </span>
        </div>
        <div className="jp-stat jp-stat-progress">
          <span className="jp-stat-l">{L('Progress', 'التقدم')}</span>
          <span className="jp-stat-v">{plan.progressPct}<small>%</small></span>
          <span className="jp-stat-h">{plan.reachedCount}/{plan.total} {L('stops', 'محطات')}</span>
        </div>
      </div>

      <div className="jp-rail" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={plan.progressPct} aria-valuetext={`${plan.progressPct}% · ${plan.reachedCount}/${plan.total}`}>
        <div className="jp-rail-track">
          <span className="jp-rail-fill" style={{ width: `${plan.progressPct}%` }} />
          <span className="jp-rail-head" style={{ '--jp-p': plan.progressPct / 100 } as CSSProperties} />
          {plan.corridorStops.map((s) => (
            <span
              key={s.id}
              className={cn('jp-rail-tick', s.reached && 'done', s.next && 'next')}
              style={{ insetInlineStart: `${s.atPct}%` }}
              title={s.name}
            />
          ))}
        </div>
      </div>

      <CorridorMap
        stops={plan.corridorStops}
        truck={plan.truck}
        truckAtStop={plan.truckAtStop}
        lang={lang}
        tone={plan.statusTone}
        live={live}
        lastFixLabel={lastFixLabel ? L(`Last signal ${lastFixLabel}`, `آخر إشارة ${lastFixLabel}`) : null}
        coldLabel={plan.coldChainLabel}
        coldTone={plan.coldChainTone}
      />

      <ol className="jp-milestones" aria-label={L('Journey milestones', 'محطات الرحلة')}>
        {plan.milestones.map((m) => <MilestoneCard key={m.key} m={m} lang={lang} />)}
      </ol>

      <footer className="jp-foot">
        <div className="jp-foot-info">
          <Thermometer aria-hidden="true" />
          <span>
            {plan.readingsCount > 0
              ? L(`${plan.inRangePct}% of readings in range`, `${plan.inRangePct}% من القراءات ضمن النطاق`)
              : L('No readings yet', 'لا توجد قراءات بعد')}
            {plan.alertCount > 0 && <b className="bad">{L(`${plan.alertCount} alert`, `${plan.alertCount} تنبيه`)}</b>}
          </span>
        </div>

        {audience === 'driver' && shipment.status === 'on_the_road' && plan.nextStop ? (
          <div className="jp-next">
            <span className="jp-next-l">
              <span>{L('Next', 'التالي')}</span>
              <b>{plan.milestones.find((m) => m.state === 'next')?.name ?? ''}</b>
              {nextKm && <small>{nextKm}</small>}
            </span>
            <button type="button" className="jp-cta" onClick={onArrive} disabled={!onArrive}>
              <Flag aria-hidden="true" />
              {L('I have arrived', 'وصلت')}
              <ChevronRight aria-hidden="true" className="jp-cta-arrow" />
            </button>
          </div>
        ) : audience === 'customer' ? (
          <button type="button" className={cn('jp-cta ghost', copied && 'done')} onClick={() => share('copy')}>
            {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
            {copied ? L('Copied', 'تم النسخ') : L('Copy trip update', 'نسخ تحديث الرحلة')}
          </button>
        ) : (
          <span className={cn('jp-state', toneClass[plan.statusTone])}>
            <IdleIcon aria-hidden="true" />
            {idleState.label}
          </span>
        )}
      </footer>
    </section>
  );
}
