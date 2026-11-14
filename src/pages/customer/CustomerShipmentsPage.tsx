import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, PackageOpen, Plus, Search, Truck, Users, Clock, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useTheme } from '@/lib/theme-context';
import { DriversDialog } from '@/features/shipments/components/DriversDialog';
import { NewShipmentDialog } from '@/features/shipments/components/NewShipmentDialog';
import { ShipmentCard } from '@/features/shipments/components/ShipmentCard';
import { ShipmentDetailSheet } from '@/features/shipments/components/ShipmentDetailSheet';
import { useShipments } from '@/features/shipments/hooks';
import { attentionState, latestReading } from '@/features/shipments/route';
import type { ShipmentWithDetails } from '@/features/shipments/types';

type Filter = 'all' | 'on_the_road' | 'attention' | 'preparing' | 'delivered';

interface Tile { key: Exclude<Filter, 'all'>; en: string; ar: string; icon: LucideIcon; tone: string }
const TILES: Tile[] = [
  { key: 'on_the_road', en: 'On the road', ar: 'في الطريق', icon: Truck, tone: 'bg-primary/10 text-primary' },
  { key: 'attention', en: 'Needs attention', ar: 'تحتاج متابعة', icon: AlertTriangle, tone: 'bg-destructive/10 text-destructive' },
  { key: 'preparing', en: 'Preparing', ar: 'قيد التجهيز', icon: Clock, tone: 'bg-amber-500/10 text-amber-700 dark:text-amber-400' },
  { key: 'delivered', en: 'Delivered', ar: 'تم التسليم', icon: CheckCircle2, tone: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' },
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
  const [openId, setOpenId] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [showDrivers, setShowDrivers] = useState(false);

  const matches = (s: ShipmentWithDetails, f: Filter) =>
    f === 'all' ? true
      : f === 'attention' ? attentionState(s, latestReading(s.readings), now) !== null
        : s.status === f;

  const counts = useMemo(() => {
    const c = { on_the_road: 0, attention: 0, preparing: 0, delivered: 0 } as Record<Tile['key'], number>;
    shipments.forEach((s) => (Object.keys(c) as Tile['key'][]).forEach((k) => { if (matches(s, k)) c[k] += 1; }));
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shipments, now]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return shipments.filter((s) =>
      matches(s, filter)
      && (!q || s.reference.toLowerCase().includes(q) || s.cargo.toLowerCase().includes(q) || (s.driver?.display_name ?? '').toLowerCase().includes(q)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shipments, filter, query, now]);

  const activeTile = TILES.find((t) => t.key === filter);

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 pb-20" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">{L('Shipments', 'الشحنات')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{L('Egypt → Qatar, with the truck’s temperature checked every few hours.', 'من مصر إلى قطر، مع فحص حرارة الشاحنة كل بضع ساعات.')}</p>
        </div>
        {shipments.length > 0 && (
          <div className="flex items-center gap-2">
            <Button variant="outline" className="h-11" onClick={() => setShowDrivers(true)}>
              <Users className="me-2 h-4 w-4" aria-hidden="true" />{L('Drivers', 'السائقون')}
            </Button>
            <Button className="h-11 rounded-full px-5" onClick={() => setShowNew(true)}>
              <Plus className="me-2 h-4 w-4" aria-hidden="true" />{L('New shipment', 'شحنة جديدة')}
            </Button>
          </div>
        )}
      </header>

      {shipments.length > 0 && (
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label={L('Shipment status', 'حالة الشحنات')}>
          {TILES.map((t) => {
            const active = filter === t.key;
            const urgent = t.key === 'attention' && counts.attention > 0;
            return (
              <button
                key={t.key}
                type="button"
                aria-pressed={active}
                onClick={() => setFilter(active ? 'all' : t.key)}
                className={cn(
                  'flex flex-col gap-3 rounded-2xl border bg-card p-4 text-start transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                  active ? 'border-primary ring-2 ring-primary/30' : urgent ? 'border-destructive/50' : 'border-border hover:border-foreground/30',
                )}
              >
                <span className={cn('flex h-9 w-9 items-center justify-center rounded-xl', t.tone)}><t.icon className="h-5 w-5" aria-hidden="true" /></span>
                <span className={cn('text-4xl font-extrabold leading-none tabular-nums', urgent && 'text-destructive')}>{counts[t.key]}</span>
                <span className="text-sm font-medium text-muted-foreground">{lang === 'ar' ? t.ar : t.en}</span>
              </button>
            );
          })}
        </section>
      )}

      {shipments.length > 0 && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-lg font-bold">
            {activeTile ? (lang === 'ar' ? activeTile.ar : activeTile.en) : L('All shipments', 'كل الشحنات')}
            <span className="ms-2 text-sm font-normal text-muted-foreground">{visible.length}</span>
            {filter !== 'all' && (
              <button type="button" onClick={() => setFilter('all')} className="ms-3 text-sm font-semibold text-primary hover:underline">{L('Show all', 'عرض الكل')}</button>
            )}
          </h2>
          <div className="relative w-full sm:w-80">
            <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={L('Search reference, cargo or driver', 'ابحث بالرقم أو الشحنة أو السائق')} className="h-11 ps-9" aria-label={L('Search shipments', 'بحث في الشحنات')} />
          </div>
        </div>
      )}

      {isLoading && <div className="grid gap-4 xl:grid-cols-2"><Skeleton className="h-80 rounded-2xl" /><Skeleton className="h-80 rounded-2xl" /></div>}
      {isError && <p className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive" role="alert">{L('Could not load shipments. Refresh the page or try again shortly.', 'تعذر تحميل الشحنات. حدّث الصفحة أو حاول بعد قليل.')}</p>}

      {!isLoading && !isError && shipments.length === 0 && (
        <section className="flex flex-col items-center gap-4 rounded-3xl border border-dashed border-border bg-card px-6 py-16 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary"><PackageOpen className="h-8 w-8" aria-hidden="true" /></span>
          <div className="max-w-md space-y-1">
            <h2 className="text-xl font-extrabold">{L('No shipments yet', 'لا توجد شحنات بعد')}</h2>
            <p className="text-sm text-muted-foreground">{L('Dispatch your first truck from Egypt to Qatar. Your driver photographs the cooling unit’s screen along the way, and you see every reading here.', 'أرسل أول شاحنة من مصر إلى قطر. يصوّر السائق شاشة وحدة التبريد في الطريق وتشاهد كل قراءة هنا.')}</p>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            <Button className="h-11 rounded-full px-6" onClick={() => setShowNew(true)}><Plus className="me-2 h-4 w-4" aria-hidden="true" />{L('New shipment', 'شحنة جديدة')}</Button>
            <Button variant="outline" className="h-11" onClick={() => setShowDrivers(true)}><Users className="me-2 h-4 w-4" aria-hidden="true" />{L('Add a driver first', 'أضف سائقاً أولاً')}</Button>
          </div>
        </section>
      )}

      {!isLoading && shipments.length > 0 && (
        visible.length === 0
          ? <p className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">{L('No shipments match.', 'لا توجد شحنات مطابقة.')}</p>
          : <div className="grid gap-4 xl:grid-cols-2">{visible.map((s) => <ShipmentCard key={s.id} shipment={s} lang={lang} now={now} onOpen={() => setOpenId(s.id)} />)}</div>
      )}

      <ShipmentDetailSheet shipmentId={openId} lang={lang} now={now} onClose={() => setOpenId(null)} />
      <NewShipmentDialog open={showNew} onOpenChange={setShowNew} lang={lang} onManageDrivers={() => { setShowNew(false); setShowDrivers(true); }} onCreated={setOpenId} />
      <DriversDialog open={showDrivers} onOpenChange={setShowDrivers} lang={lang} />
    </div>
  );
}
