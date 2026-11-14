import type { Lang } from '../route';
import type { ShipmentReading } from '../types';

const W = 320;
const H = 140;
const PAD = { l: 30, r: 8, t: 8, b: 10 };

/**
 * Temperature over time with the allowed band shaded green. An out-of-range reading is a red triangle, an
 * in-range one a dot. Drawn in fixed portal colours so it reads the same in every palette.
 */
export function TrendChart({ readings, targetC, toleranceC, lang }: { readings: ShipmentReading[]; targetC: number; toleranceC: number; lang: Lang }) {
  const L = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  const points = [...readings].sort((a, b) => new Date(a.taken_at).getTime() - new Date(b.taken_at).getTime()).slice(-30);
  if (points.length < 2) {
    return <p style={{ margin: 0, fontSize: 11, color: '#6b7a9c' }}>{L('The chart appears after at least two readings.', 'يظهر الرسم البياني بعد قراءتين على الأقل.')}</p>;
  }
  const temps = points.map((p) => Number(p.temperature_c));
  const lo = Math.min(...temps, targetC - toleranceC) - 2;
  const hi = Math.max(...temps, targetC + toleranceC) + 2;
  const t0 = new Date(points[0].taken_at).getTime();
  const t1 = new Date(points[points.length - 1].taken_at).getTime();
  const x = (iso: string) => PAD.l + ((new Date(iso).getTime() - t0) / Math.max(1, t1 - t0)) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo)) * (H - PAD.t - PAD.b);
  const line = points.map((p) => `${x(p.taken_at).toFixed(1)},${y(Number(p.temperature_c)).toFixed(1)}`).join(' ');
  const top = y(targetC + toleranceC);
  const bottom = y(targetC - toleranceC);
  return (
    <div>
      <svg className="cs-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={L('Temperature over time', 'منحنى درجة الحرارة')}>
        <rect x={PAD.l} y={top} width={W - PAD.l - PAD.r} height={Math.max(0, bottom - top)} fill="#bfeed8" fillOpacity=".55" />
        <line x1={PAD.l} x2={W - PAD.r} y1={y(targetC)} y2={y(targetC)} stroke="#10b981" strokeOpacity=".7" strokeDasharray="4 3" />
        {[hi, targetC, lo].map((v) => (
          <text key={v} x={PAD.l - 4} y={y(v) + 3} textAnchor="end" fontSize="9" fill="#6b7a9c">{Math.round(v)}°</text>
        ))}
        <polyline points={line} fill="none" stroke="#2f73f4" strokeWidth="1.8" strokeLinejoin="round" />
        {points.map((p) => {
          const cx = x(p.taken_at);
          const cy = y(Number(p.temperature_c));
          return p.is_alert
            ? <polygon key={p.id} points={`${cx},${cy - 5} ${cx - 5},${cy + 4} ${cx + 5},${cy + 4}`} fill="#f0245b" />
            : <circle key={p.id} cx={cx} cy={cy} r="2.8" fill="#2f73f4" stroke="#fff" strokeWidth="1" />;
        })}
      </svg>
      <div className="cs-legend">
        <span><i style={{ background: '#bfeed8' }} />{L('Allowed', 'المسموح')} ({Math.round(targetC - toleranceC)}° … {Math.round(targetC + toleranceC)}°)</span>
        <span><i style={{ background: '#2f73f4', borderRadius: '50%' }} />{L('In range', 'ضمن النطاق')}</span>
        <span><i style={{ background: '#f0245b' }} />{L('Out of range', 'خارج النطاق')}</span>
      </div>
    </div>
  );
}
