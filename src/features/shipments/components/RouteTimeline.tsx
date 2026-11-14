import { Check, MapPin, UserPlus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { stopName, stopProgress, type Lang } from '../route';
import type { ShipmentStop } from '../types';

const time = (iso: string, lang: Lang) =>
  new Date(iso).toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** The route top to bottom: reached stops are ticked, the next one is marked, the rest are pending. */
export function RouteTimeline({ stops, lang }: { stops: ShipmentStop[]; lang: Lang }) {
  const { stops: ordered, next } = stopProgress(stops);
  return (
    <ol className="space-y-0">
      {ordered.map((s, i) => {
        const reached = !!s.reached_at;
        const isNext = next?.id === s.id;
        return (
          <li key={s.id} className="relative flex gap-3 pb-4 last:pb-0">
            {i < ordered.length - 1 && (
              <span className={cn('absolute start-[11px] top-6 h-[calc(100%-1.5rem)] w-0.5', reached ? 'bg-primary' : 'bg-border')} aria-hidden="true" />
            )}
            <span
              className={cn(
                'relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2',
                reached ? 'border-primary bg-primary text-primary-foreground' : isNext ? 'border-primary bg-background text-primary' : 'border-border bg-background text-muted-foreground',
              )}
            >
              {reached ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <MapPin className="h-3.5 w-3.5" aria-hidden="true" />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className={cn('text-sm font-semibold', !reached && !isNext && 'text-muted-foreground')}>{stopName(s, lang)}</span>
                {s.kind === 'driver' && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    <UserPlus className="h-3 w-3" aria-hidden="true" />
                    {lang === 'ar' ? 'أضافه السائق' : 'Added by driver'}
                  </span>
                )}
                {isNext && <span className="text-[10px] font-semibold text-primary">{lang === 'ar' ? 'المحطة التالية' : 'Next stop'}</span>}
              </div>
              <div className="text-[11px] text-muted-foreground">
                {reached ? time(s.reached_at as string, lang) : lang === 'ar' ? 'لم يصل بعد' : 'Not reached yet'}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
