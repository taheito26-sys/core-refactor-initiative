// ─── Orders page: this month against last month ───

export interface GrowthRow {
  date: number;
  /** Order total in its own currency. */
  totalAmount: number;
  currency: string;
  loanAmount: number | null;
  loanCurrency: string | null;
  sale?: boolean;
  qarToEgpRate: number | null;
}

export interface MonthFigures {
  count: number;
  volumeEgp: number;
  totalQar: number;
  /** Loaned amount (QAR) placed up to the end of the month: the running total debt. */
  debtThrough: number;
}

/** "YYYY-MM" of a timestamp in local time, the key the month chips use. */
export function monthOf(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function previousMonth(key: string): string {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function qarOf(r: GrowthRow): number {
  if (r.loanAmount != null && r.loanCurrency === 'QAR') return r.loanAmount;
  if (r.sale && r.currency === 'EGP' && r.qarToEgpRate && r.qarToEgpRate > 0) return r.totalAmount / r.qarToEgpRate;
  return 0;
}

/** The same figures the summary tiles show for a month, computed the same way. */
export function monthFigures(rows: GrowthRow[], key: string): MonthFigures {
  let count = 0, volumeEgp = 0, totalQar = 0, debtThrough = 0;
  for (const r of rows) {
    const m = monthOf(r.date);
    if (m === key) {
      count += 1;
      if (r.currency === 'EGP') volumeEgp += r.totalAmount;
      totalQar += qarOf(r);
    }
    if (m <= key && r.loanAmount != null && r.loanCurrency === 'QAR') debtThrough += r.loanAmount;
  }
  return { count, volumeEgp, totalQar, debtThrough };
}

export interface Growth {
  /** Percent change, or null when last month had nothing to compare with. */
  pct: number | null;
  /** Absolute change. */
  delta: number;
  up: boolean;
}

export function growth(current: number, previous: number): Growth {
  const delta = current - previous;
  const pct = previous > 0 ? Math.round((delta / previous) * 100) : null;
  return { pct, delta, up: delta >= 0 };
}
