// ─── RetentionIndicator — Phase 18: Message retention display ───────────
import { Timer, Trash2, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { retentionLabel } from '../lib/privacy-engine';

interface Props {
  retentionHours: number | null;
  compact?: boolean;
}

export function RetentionIndicator({ retentionHours, compact = false }: Props) {
  const isIndefinite = !retentionHours;
  const label = retentionLabel(retentionHours);

  if (compact) {
    return (
      <span className={cn(
        'inline-flex items-center gap-0.5 text-[10px] font-medium',
        isIndefinite ? 'text-muted-foreground/50' : 'text-amber-500',
      )} title={`Message retention: ${label}`}>
        <Timer className="h-2.5 w-2.5" />
        {label}
      </span>
    );
  }

  return (
    <div className={cn(
      'flex items-center gap-2.5 px-3 py-2 rounded-lg',
      isIndefinite ? 'bg-muted/50' : 'bg-amber-500/10',
    )}>
      {isIndefinite ? (
        <Clock className="h-4 w-4 text-muted-foreground/50" />
      ) : (
        <Trash2 className="h-4 w-4 text-amber-500" />
      )}
      <div>
        <p className={cn(
          'text-[11px] font-bold',
          isIndefinite ? 'text-muted-foreground' : 'text-amber-600 dark:text-amber-400',
        )}>
          {isIndefinite ? 'Messages kept indefinitely' : `Auto-delete after ${label}`}
        </p>
        <p className="text-[9px] text-muted-foreground/60 mt-0.5">
          {isIndefinite
            ? 'Messages in this room are stored permanently'
            : 'Older messages will be automatically removed'}
        </p>
      </div>
    </div>
  );
}

// Room info section version
export function RetentionSection({ retentionHours }: { retentionHours: number | null }) {
  return (
    <div className="px-4 py-3 border-b border-border/50">
      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/50 mb-2">
        Message Retention
      </p>
      <RetentionIndicator retentionHours={retentionHours} />
    </div>
  );
}
