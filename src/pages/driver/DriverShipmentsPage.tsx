import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Truck } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { useTheme } from '@/lib/theme-context';
import { DueBadge } from '@/features/shipments/components/DueBadge';
import { StatusChip } from '@/features/shipments/components/StatusChip';
import { StopSegments } from '@/features/shipments/components/StopSegments';
import { useShipments } from '@/features/shipments/hooks';
import { latestReading, readingDue, stopName, stopProgress } from '@/features/shipments/route';

const ORDER = { on_the_road: 0, preparing: 1, delivered: 2, cancelled: 3 } as const;

/** The driver's shipments: the one on the road first, then the ones waiting to start. */
export default function DriverShipmentsPage() {
  const { settings } = useTheme();
  const lang = settings.language === 'ar' ? 'ar' : 'en';
  const L = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  const { data: shipments = [], isLoading, isError } = useShipments();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(id); }, []);
  const sorted = useMemo(() => [...shipments].sort((a, b) => ORDER[a.status] - ORDER[b.status]), [shipments]);

  return (
    <div className="space-y-3">
      <h1 className="text-xl font-extrabold">{L('My shipments', 'شحناتي')}</h1>
      {isLoading && <><Skeleton className="h-28" /><Skeleton className="h-28" /></>}
      {isError && <p className="text-sm text-destructive" role="alert">{L('Could not load. Check your signal.', 'تعذر التحميل. تحقق من الإشارة.')}</p>}
      {!isLoading && sorted.length === 0 && <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">{L('No shipments are assigned to you yet.', 'لا توجد شحنات معيّنة لك بعد.')}</p>}
      {sorted.map((s) => {
        const p = stopProgress(s.stops);
        const last = latestReading(s.readings);
        return (
          <Link key={s.id} to={`/d/shipments/${s.id}`} className="block space-y-2.5 rounded-2xl border border-border bg-card p-4 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            <div className="flex items-center gap-2">
              <Truck className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
              <span className="text-base font-bold">{s.reference}</span>
              <span className="ms-auto"><StatusChip status={s.status} lang={lang} /></span>
            </div>
            <div className="truncate text-sm text-muted-foreground">{s.cargo}</div>
            <StopSegments stops={p.stops} reachedCount={p.reachedCount} />
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="min-w-0 truncate text-muted-foreground">
                {p.next ? `${L('Next', 'التالي')}: ${stopName(p.next, lang)}` : p.destination ? stopName(p.destination, lang) : ''}
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground rtl:-scale-x-100" aria-hidden="true" />
            </div>
            <DueBadge due={readingDue(s, last?.taken_at ?? null, now)} lang={lang} now={now} />
          </Link>
        );
      })}
    </div>
  );
}
