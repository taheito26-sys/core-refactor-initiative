import type { Lang } from '../route';
import type { ShipmentReading } from '../types';

const W = 320;
const H = 150;
const PAD = { l: 34, r: 8, t: 8, b: 18 };

/**
 * Temperature over time with the allowed band shaded. An out-of-range reading is drawn as a
 * triangle and an in-range one as a dot, so the chart reads without colour.
 */
export function TemperatureChart({
  readings, targetC, toleranceC, lang,
}: { readings: ShipmentReading[]; targetC: number; toleranceC: number; lang: Lang }) {
  const points = [...readings].sort((a, b) => new Date(a.taken_at).getTime() - new Date(b.taken_at).getTime()).slice(-30);
  if (points.length < 2) {
    return (
      <p className="text-sm text-muted-foreground">
        {lang === 'ar' ? 'يظهر الرسم البياني بعد قراءتين على الأقل.' : 'The chart appears after at least two readings.'}
      </p>
    );
  }
  const temps = points.map((p) => p.temperature_c);
  const lo = Math.min(...temps, targetC - toleranceC) - 2;
  const hi = Math.max(...temps, targetC + toleranceC) + 2;
  const t0 = new Date(points[0].taken_at).getTime();
  const t1 = new Date(points[points.length - 1].taken_at).getTime();
  const x = (iso: string) => PAD.l + ((new Date(iso).getTime() - t0) / Math.max(1, t1 - t0)) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo)) * (H - PAD.t - PAD.b);
  const line = points.map((p) => `${x(p.taken_at).toFixed(1)},${y(p.temperature_c).toFixed(1)}`).join(' ');
  const bandTop = y(targetC + toleranceC);
  const bandBottom = y(targetC - toleranceC);

  return (
    <figure className="space-y-2">
    <svg viewBox={`0 0 ${W} ${H}`} className="mx-auto w-full max-w-md" role="img" aria-label={lang === 'ar' ? 'منحنى درجة الحرارة' : 'Temperature over time'} style={{ direction: 'ltr' }}>
      <rect x={PAD.l} y={bandTop} width={W - PAD.l - PAD.r} height={Math.max(0, bandBottom - bandTop)} className="fill-emerald-500/10" />
      <line x1={PAD.l} x2={W - PAD.r} y1={y(targetC)} y2={y(targetC)} className="stroke-emerald-500/60" strokeDasharray="4 3" />
      {[hi, targetC, lo].map((v) => (
        <text key={v} x={PAD.l - 4} y={y(v) + 3} textAnchor="end" className="fill-muted-foreground text-[9px]">{Math.round(v)}°</text>
      ))}
      <polyline points={line} fill="none" className="stroke-primary" strokeWidth={1.5} />
      {points.map((p) => {
        const cx = x(p.taken_at);
        const cy = y(p.temperature_c);
        return p.is_alert ? (
          <polygon key={p.id} points={`${cx},${cy - 4.5} ${cx - 4.5},${cy + 3.5} ${cx + 4.5},${cy + 3.5}`} className="fill-destructive" />
        ) : (
          <circle key={p.id} cx={cx} cy={cy} r={2.5} className="fill-primary" />
        );
      })}
    </svg>
    <figcaption className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-4 rounded-sm bg-emerald-500/30 ring-1 ring-emerald-500/60" aria-hidden="true" />{lang === 'ar' ? 'النطاق المسموح' : 'Allowed range'} ({Math.round(targetC - toleranceC)}° … {Math.round(targetC + toleranceC)}°)</span>
      <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full bg-primary" aria-hidden="true" />{lang === 'ar' ? 'ضمن النطاق' : 'In range'}</span>
      <span className="inline-flex items-center gap-1.5"><svg width="12" height="12" viewBox="0 0 16 16" className="fill-destructive" aria-hidden="true"><path d="M8 1.5 15 14H1z" /></svg>{lang === 'ar' ? 'خارج النطاق' : 'Out of range'}</span>
    </figcaption>
    </figure>
  );
}
