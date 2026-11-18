import { ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { coldChainStats } from '../cold-chain';
import { durationLabel, rangeScale, type Lang } from '../route';
import type { ShipmentReading } from '../types';

const temp = (n: number | null) => (n === null ? '—' : Number.isInteger(n) ? String(n) : n.toFixed(1));

/**
 * The cold-chain read on a trip: a 0-100 stability score, the extremes, how much of the record
 * stayed inside the band, and a one-axis distribution that shows isolated spikes versus a drift.
 */
export function ColdChainPanel({ readings, targetC, toleranceC, now, lang }: {
  readings: ShipmentReading[];
  targetC: number;
  toleranceC: number;
  now: number;
  lang: Lang;
}) {
  const L = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  const s = coldChainStats(readings, targetC, toleranceC, now);
  const scale = rangeScale(targetC, toleranceC, null);
  const circumference = 2 * Math.PI * 42;
  const bandLabel = s.band === 'stable' ? L('Stable', 'مستقرة') : s.band === 'watch' ? L('Watch', 'تحت المراقبة') : s.band === 'risk' ? L('At risk', 'معرضة للخطر') : L('No data', 'لا توجد بيانات');
  const summary = !s.readingCount
    ? L('No temperature readings yet. The score appears after the first reading.', 'لا توجد قراءات حرارة بعد. يظهر المؤشر بعد أول قراءة.')
    : s.band === 'stable'
      ? L('The record is stable: every reading stayed inside the allowed band.', 'السجل مستقر: كل القراءات بقيت ضمن النطاق المسموح.')
      : s.excursionCount === 0
        ? L('Every reading is inside the band; the spread is wider than ideal.', 'كل القراءات ضمن النطاق، لكن انتشار الحرارة أوسع من المثالي.')
        : L(`${s.excursionCount} excursion${s.excursionCount === 1 ? '' : 's'} left the band; the longest lasted ${durationLabel(s.longestExcursionMs, lang)}.`, `${s.excursionCount} خروج عن النطاق؛ أطولها استمر ${durationLabel(s.longestExcursionMs, lang)}.`);

  return (
    <section className="ch-card cs-box cs-cold">
      <h3><ShieldCheck aria-hidden="true" />{L('Cold-chain intelligence', 'ذكاء سلسلة التبريد')}<small>{L(`${s.readingCount} readings`, `${s.readingCount} قراءة`)}</small></h3>

      <div className="cs-cold-hero">
        <div className={cn('cs-cold-score', s.band)} aria-label={L(`Cold-chain score ${s.score} out of 100`, `مؤشر سلسلة التبريد ${s.score} من 100`)}>
          <svg viewBox="0 0 100 100" aria-hidden="true">
            <circle className="bg" cx="50" cy="50" r="42" />
            <circle className="fg" cx="50" cy="50" r="42" style={{ strokeDasharray: `${(s.score / 100) * circumference} ${circumference}` }} />
          </svg>
          <div><b>{s.score}</b><small>/100</small></div>
        </div>
        <div className="cs-cold-copy">
          <b className={cn('cs-cold-band', s.band)}>{bandLabel}</b>
          <p>{summary}</p>
          <span>{L('Target', 'المطلوب')} <b dir="ltr">{temp(targetC)}°C ± {temp(toleranceC)}°</b></span>
        </div>
      </div>

      <div className="cs-cold-kpis">
        <div><span>{L('Coldest', 'الأبرد')}</span><b dir="ltr">{temp(s.minC)}°C</b></div>
        <div><span>{L('Warmest', 'الأدفأ')}</span><b dir="ltr">{temp(s.maxC)}°C</b></div>
        <div><span>{L('Average', 'المتوسط')}</span><b dir="ltr">{temp(s.avgC)}°C</b></div>
        <div><span>{L('In range', 'ضمن النطاق')}</span><b dir="ltr">{s.inRangePct === null ? '—' : `${s.inRangePct}%`}</b></div>
        <div><span>{L('Excursions', 'مرات الخروج')}</span><b dir="ltr">{s.excursionCount}</b></div>
        <div><span>{L('Longest', 'الأطول')}</span><b>{s.longestExcursionMs > 0 ? durationLabel(s.longestExcursionMs, lang) : '—'}</b></div>
      </div>

      <div className="cs-cold-dist">
        <div className="cs-cold-axis" aria-hidden="true">
          <span className="band" style={{ left: `${scale.bandStartPct}%`, width: `${scale.bandEndPct - scale.bandStartPct}%` }} />
          {readings.map((r, i) => {
            const pct = rangeScale(targetC, toleranceC, Number(r.temperature_c)).markerPct;
            if (pct === null) return null;
            return <i key={r.id} className={cn('dot', r.is_alert && 'bad')} style={{ left: `${Math.min(100, Math.max(0, pct))}%`, top: `${9 + (i % 3) * 7}px` }} />;
          })}
        </div>
        <div className="cs-cold-labels"><span dir="ltr">{temp(scale.bandLow)}°</span><span>{L('Allowed band', 'النطاق المسموح')}</span><span dir="ltr">{temp(scale.bandHigh)}°</span></div>
      </div>
    </section>
  );
}
