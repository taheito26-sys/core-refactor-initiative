import { normalizeGiverText } from './cash-givers';

export interface SequencedPayment {
  key: string;
  date: number;
  status?: 'completed' | 'pending' | 'rejected';
}

/** One chronological sequence across all givers, restarted for each local calendar month.
 * Build from the full payment history before applying view filters. Legacy note numbers
 * are descriptive text only and must never override the displayed monthly number.
 */
export function monthlyPaymentNumbers(rows: readonly SequencedPayment[]): Map<string, number> {
  const numbers = new Map<string, number>();
  const counts = new Map<string, number>();
  const sorted = rows.filter(row => row.status !== 'rejected' && Number.isFinite(row.date))
    .slice().sort((a, b) => a.date - b.date || a.key.localeCompare(b.key));
  for (const row of sorted) {
    if (numbers.has(row.key)) continue;
    const date = new Date(row.date);
    const month = `${date.getFullYear()}-${date.getMonth() + 1}`;
    const number = (counts.get(month) ?? 0) + 1;
    counts.set(month, number);
    numbers.set(row.key, number);
  }
  return numbers;
}

/** Independent monthly counts for each giver; old numbers in notes never override them. */
export function monthlyGiverPaymentNumbers(rows: readonly (SequencedPayment & { giver: string | null })[]): Map<string, number> {
  const numbers = new Map<string, number>();
  const counts = new Map<string, number>();
  const sorted = rows.filter(row => row.status !== 'rejected' && Number.isFinite(row.date) && row.giver?.trim())
    .slice().sort((a, b) => a.date - b.date || a.key.localeCompare(b.key));
  for (const row of sorted) {
    if (numbers.has(row.key)) continue;
    const date = new Date(row.date);
    const group = JSON.stringify([date.getFullYear(), date.getMonth(), normalizeGiverText(row.giver!)]);
    const number = (counts.get(group) ?? 0) + 1;
    counts.set(group, number);
    numbers.set(row.key, number);
  }
  return numbers;
}
