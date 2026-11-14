import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { sortStops, stopName, stopProgress, type Lang } from '../route';
import type { ShipmentStatus, ShipmentStop } from '../types';

/** The route as a vertical list: a filled dot and the time for each stop reached, the next stop marked, the rest waiting. */
export function RouteList({ stops, status, lang }: { stops: ShipmentStop[]; status: ShipmentStatus; lang: Lang }) {
  const L = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  const progress = stopProgress(stops);
  const dateFmt = (iso: string) => new Date(iso).toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  return (
    <ul className="cs-route" style={{ margin: 0, padding: 0 }}>
      {sortStops(stops).map((s) => {
        const reached = !!s.reached_at;
        const next = !reached && progress.next?.id === s.id && status === 'on_the_road';
        return (
          <li key={s.id} className={cn(reached && 'reached', next && 'next')}>
            <span className="pt">{reached && <Check aria-hidden="true" />}</span>
            <div>
              <div className="nm">{stopName(s, lang)}{s.kind === 'driver' && <span className="tag">{L('added by driver', 'أضافها السائق')}</span>}</div>
              <div className="tm">{reached && s.reached_at ? dateFmt(s.reached_at) : next ? L('Next stop', 'المحطة التالية') : L('Not reached yet', 'لم يصل بعد')}</div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
