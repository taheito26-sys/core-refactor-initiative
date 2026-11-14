import { useEffect, useMemo, useState } from 'react';
import { LayoutGrid, Plus, Rows3, Search, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useTheme } from '@/lib/theme-context';
import { DriversDialog } from '@/features/shipments/components/DriversDialog';
import { FleetPulse } from '@/features/shipments/components/FleetPulse';
import { NewShipmentDialog } from '@/features/shipments/components/NewShipmentDialog';
import { ShipmentCard } from '@/features/shipments/components/ShipmentCard';
import { ShipmentDetailSheet } from '@/features/shipments/components/ShipmentDetailSheet';
import { StatusChip } from '@/features/shipments/components/StatusChip';
import { TemperatureReadout } from '@/features/shipments/components/TemperatureReadout';
import { useShipments } from '@/features/shipments/hooks';
import { latestReading, stopName, stopProgress } from '@/features/shipments/route';
import type { ShipmentStatus } from '@/features/shipments/types';

type Filter = 'all' | ShipmentStatus;
const FILTERS: { key: Filter; en: string; ar: string }[] = [
  { key: 'all', en: 'All', ar: 'الكل' },
  { key: 'preparing', en: 'Preparing', ar: 'قيد التجهيز' },
  { key: 'on_the_road', en: 'On the road', ar: 'في الطريق' },
  { key: 'delivered', en: 'Delivered', ar: 'تم التسليم' },
  { key: 'cancelled', en: 'Cancelled', ar: 'ملغاة' },
];

/** Customer portal: dispatch Egypt → Qatar shipments and follow each truck and its temperature. */
export default function CustomerShipmentsPage() {
  const { settings } = useTheme();
  const lang = settings.language === 'ar' ? 'ar' : 'en';
  const L = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  const { data: shipments = [], isLoading, isError } = useShipments();

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'cards' | 'table'>('cards');
  const [openId, setOpenId] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [showDrivers, setShowDrivers] = useState(false);

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: shipments.length, preparing: 0, on_the_road: 0, delivered: 0, cancelled: 0 };
    shipments.forEach((s) => { c[s.status] += 1; });
    return c;
  }, [shipments]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return shipments.filter((s) =>
      (filter === 'all' || s.status === filter)
      && (!q || s.reference.toLowerCase().includes(q) || s.cargo.toLowerCase().includes(q) || (s.driver?.display_name ?? '').toLowerCase().includes(q)),
    );
  }, [shipments, filter, query]);

  const pad = (n: number) => String(n).padStart(2, '0');

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 pb-16" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <header className="flex items-end justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold text-muted-foreground">{L('Operations', 'التشغيل')} · {shipments.length} {L('shipments', 'شحنات')}</div>
          <h1 className="text-2xl font-extrabold tracking-tight">{L('Shipments', 'الشحنات')}</h1>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowDrivers(true)}>
            <Users className="me-1.5 h-4 w-4" aria-hidden="true" />{L('Drivers', 'السائقون')}
          </Button>
          <Button size="sm" onClick={() => setShowNew(true)} className="rounded-full">
            <Plus className="me-1.5 h-4 w-4" aria-hidden="true" />{L('New shipment', 'شحنة جديدة')}
          </Button>
        </div>
      </header>

      <FleetPulse shipments={shipments} lang={lang} now={now} onOpen={setOpenId} />

      <section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-3 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={L('Search by reference, cargo or driver…', 'ابحث بالرقم أو الشحنة أو السائق…')} className="ps-9" aria-label={L('Search shipments', 'بحث في الشحنات')} />
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-0.5" role="tablist" aria-label={L('Filter by status', 'تصفية بالحالة')}>
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              role="tab"
              aria-selected={filter === f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                'shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition',
                filter === f.key ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground',
              )}
            >
              {lang === 'ar' ? f.ar : f.en} <span className="tabular-nums opacity-70">{pad(counts[f.key])}</span>
            </button>
          ))}
        </div>
      </section>

      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold">{L('All shipments', 'كل الشحنات')} <span className="text-xs font-normal text-muted-foreground">· {visible.length} {L('results', 'نتيجة')}</span></h2>
        <div className="inline-flex rounded-full border border-border p-0.5" role="group" aria-label={L('View', 'العرض')}>
          {([['cards', LayoutGrid, L('Cards', 'بطاقات')], ['table', Rows3, L('Table', 'جدول')]] as const).map(([key, Icon, label]) => (
            <button
              key={key}
              type="button"
              aria-pressed={view === key}
              onClick={() => setView(key)}
              className={cn('inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold', view === key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />{label}
            </button>
          ))}
        </div>
      </div>

      {isLoading && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><Skeleton className="h-56" /><Skeleton className="h-56" /><Skeleton className="h-56" /></div>}
      {isError && <p className="rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{L('Could not load shipments. Pull to refresh or try again shortly.', 'تعذر تحميل الشحنات. حدّث الصفحة أو حاول بعد قليل.')}</p>}

      {!isLoading && view === 'cards' && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((s) => <ShipmentCard key={s.id} shipment={s} lang={lang} now={now} onOpen={() => setOpenId(s.id)} />)}
          <button
            type="button"
            onClick={() => setShowNew(true)}
            className="flex min-h-40 flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-border p-4 text-center text-muted-foreground transition hover:border-primary/60 hover:text-primary"
          >
            <Plus className="h-6 w-6" aria-hidden="true" />
            <span className="text-sm font-bold text-foreground">{L('Start a new shipment', 'ابدأ شحنة جديدة')}</span>
            <span className="text-xs">{L('Add a trip to follow it from Egypt to Qatar.', 'أضف رحلة لتتابعها من مصر إلى قطر.')}</span>
          </button>
        </div>
      )}

      {!isLoading && view === 'table' && (
        <div className="overflow-x-auto rounded-2xl border border-border bg-card">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr className="border-b border-border">
                {[L('Reference', 'الرقم'), L('Status', 'الحالة'), L('Where', 'الموقع'), L('Driver', 'السائق'), L('Temperature', 'الحرارة')].map((h) => <th key={h} className="px-3 py-2 text-start font-semibold">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {visible.map((s) => {
                const p = stopProgress(s.stops);
                return (
                  <tr key={s.id} className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/50" onClick={() => setOpenId(s.id)}>
                    <td className="px-3 py-2 font-bold">
                      <button type="button" className="text-start focus-visible:underline focus-visible:outline-none" onClick={(e) => { e.stopPropagation(); setOpenId(s.id); }}>{s.reference}</button>
                      <div className="text-[11px] font-normal text-muted-foreground">{s.cargo}</div>
                    </td>
                    <td className="px-3 py-2"><StatusChip status={s.status} lang={lang} /></td>
                    <td className="px-3 py-2 text-xs">{p.current ? stopName(p.current, lang) : p.origin ? stopName(p.origin, lang) : '—'}</td>
                    <td className="px-3 py-2 text-xs">{s.driver?.display_name ?? '—'}</td>
                    <td className="px-3 py-2"><TemperatureReadout reading={latestReading(s.readings)} targetC={s.target_temp_c} lang={lang} now={now} size="sm" /></td>
                  </tr>
                );
              })}
              {visible.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-sm text-muted-foreground">{L('No shipments match.', 'لا توجد شحنات مطابقة.')}</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      <ShipmentDetailSheet shipmentId={openId} lang={lang} now={now} onClose={() => setOpenId(null)} />
      <NewShipmentDialog open={showNew} onOpenChange={setShowNew} lang={lang} onManageDrivers={() => { setShowNew(false); setShowDrivers(true); }} onCreated={setOpenId} />
      <DriversDialog open={showDrivers} onOpenChange={setShowDrivers} lang={lang} />
    </div>
  );
}
