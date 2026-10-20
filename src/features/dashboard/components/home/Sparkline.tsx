import { useId } from 'react';

interface SparklineProps {
  values: number[];
  /** A CSS colour: a theme variable such as var(--good). */
  color: string;
  kind?: 'line' | 'bars';
  className?: string;
}

/** The little trend drawn on a card: a filled line or a few rising bars, in the colour it is given. */
export function Sparkline({ values, color, kind = 'line', className }: SparklineProps) {
  const id = useId();
  const w = 100;
  const h = 40;
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const x = (i: number) => (values.length <= 1 ? w : (i / (values.length - 1)) * w);
  const y = (v: number) => h - 3 - ((v - min) / span) * (h - 8);

  if (kind === 'bars') {
    const bw = w / values.length;
    return (
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className={className} aria-hidden="true">
        {values.map((v, i) => {
          const bh = Math.max(3, ((v - min) / span) * (h - 4) + 3);
          return <rect key={i} x={i * bw + bw * 0.14} y={h - bh} width={bw * 0.72} height={bh} rx={bw * 0.18} style={{ fill: color, opacity: 0.35 + 0.65 * ((i + 1) / values.length) }} />;
        })}
      </svg>
    );
  }

  const pts = values.map((v, i) => `${x(i)},${y(v)}`);
  const line = pts.length > 0 ? `M${pts.join(' L')}` : '';
  const area = pts.length > 0 ? `${line} L${w},${h} L0,${h} Z` : '';
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: color, stopOpacity: 0.32 }} />
          <stop offset="1" style={{ stopColor: color, stopOpacity: 0 }} />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id})`} />
      <path d={line} fill="none" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" style={{ stroke: color }} />
    </svg>
  );
}
