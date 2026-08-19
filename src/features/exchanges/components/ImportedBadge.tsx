import { ArrowDownToLine } from 'lucide-react';
import { cn } from '@/lib/utils';
import { EXCHANGE_LABELS, type ExchangeId } from '../types';

const EXCHANGE_CHIP: Record<ExchangeId, string> = {
  binance: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 ring-amber-500/30',
  okx: 'bg-sky-500/15 text-sky-600 dark:text-sky-400 ring-sky-500/30',
};

/** Marks a batch/trade row that was created by importing from a connected exchange. */
export function ImportedBadge({ exchange }: { exchange: ExchangeId }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-0.5 rounded px-1 py-px text-[9px] font-semibold leading-tight ring-1 ring-inset',
        EXCHANGE_CHIP[exchange],
      )}
      title={`Already imported from ${EXCHANGE_LABELS[exchange]}`}
    >
      <ArrowDownToLine className="h-2.5 w-2.5" />
      {EXCHANGE_LABELS[exchange]}
    </span>
  );
}
