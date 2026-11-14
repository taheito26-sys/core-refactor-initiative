import { cn } from '@/lib/utils';
import type { ShipmentStop } from '../types';

/** One bar per stop, filled as the truck gets there: a compact progress indicator for cards. */
export function StopSegments({ stops, reachedCount, className }: { stops: ShipmentStop[]; reachedCount: number; className?: string }) {
  return (
    <div
      className={cn('flex gap-1', className)}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={stops.length}
      aria-valuenow={reachedCount}
    >
      {stops.map((s, i) => (
        <span key={s.id} className={cn('h-1.5 flex-1 rounded-full', i < reachedCount ? 'bg-primary' : 'bg-muted')} />
      ))}
    </div>
  );
}
