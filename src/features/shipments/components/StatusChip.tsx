import { CheckCircle2, Clock, Truck, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { STATUS_LABELS, type Lang } from '../route';
import type { ShipmentStatus } from '../types';

const STYLE: Record<ShipmentStatus, { icon: typeof Truck; className: string }> = {
  preparing: { icon: Clock, className: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 ring-amber-500/30' },
  on_the_road: { icon: Truck, className: 'bg-sky-500/10 text-sky-700 dark:text-sky-400 ring-sky-500/30' },
  delivered: { icon: CheckCircle2, className: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 ring-emerald-500/30' },
  cancelled: { icon: XCircle, className: 'bg-muted text-muted-foreground ring-border' },
};

/** Status as icon plus text, never colour alone. */
export function StatusChip({ status, lang }: { status: ShipmentStatus; lang: Lang }) {
  const { icon: Icon, className } = STYLE[status];
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ring-1 ring-inset', className)}>
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {STATUS_LABELS[status][lang]}
    </span>
  );
}
