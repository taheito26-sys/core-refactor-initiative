import { Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { EXCHANGE_LABELS, type ExchangeId } from '../types';

/** Each exchange's own brand gradient, so the badge reads at a glance without even needing the label. */
const EXCHANGE_STYLE: Record<ExchangeId, { chip: string; glow: string }> = {
  binance: {
    chip: 'bg-gradient-to-r from-[#F0B90B] via-[#F8D12F] to-[#F0B90B] text-[#1E1704] ring-[#F0B90B]/60',
    glow: 'shadow-[0_0_10px_-2px_rgba(240,185,11,0.75)]',
  },
  okx: {
    chip: 'bg-gradient-to-r from-[#00E4C6] via-[#0B0B0D] to-[#00E4C6] text-white ring-[#00E4C6]/60',
    glow: 'shadow-[0_0_10px_-2px_rgba(0,228,198,0.6)]',
  },
};

/** Marks a batch/trade row that was created by importing from a connected exchange. */
export function ImportedBadge({ exchange }: { exchange: ExchangeId }) {
  const style = EXCHANGE_STYLE[exchange];
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-px text-[9px] font-extrabold leading-tight ring-1 ring-inset',
        style.chip,
        style.glow,
      )}
      title={`Imported from ${EXCHANGE_LABELS[exchange]}`}
    >
      <Zap className="h-2.5 w-2.5 fill-current" />
      {EXCHANGE_LABELS[exchange]}
    </span>
  );
}
