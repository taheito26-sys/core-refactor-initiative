import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Bell, CheckCircle2, Clock, PackageOpen, Plus, Search, Truck, User, Users } from 'lucide-react';
import { useAuth } from '@/features/auth/auth-context';
import { resolveCustomerDisplayName } from '@/features/customer/customer-portal';
import { DriversDialog } from '@/features/shipments/components/DriversDialog';
import { NewShipmentDialog } from '@/features/shipments/components/NewShipmentDialog';
import { ShipmentCard } from '@/features/shipments/components/ShipmentCard';
import { ShipmentDetailSheet } from '@/features/shipments/components/ShipmentDetailSheet';
import { useShipments } from '@/features/shipments/hooks';
import { attentionState, latestReading } from '@/features/shipments/route';
import type { ShipmentWithDetails } from '@/features/shipments/types';
import { PortalHero } from '@/features/customer/components/PortalHero';
import { useIsMobile } from '@/hooks/use-mobile';
import { useNotifications } from '@/hooks/useNotifications';
import { useTheme } from '@/lib/theme-context';
import { cn } from '@/lib/utils';
import '@/styles/customer-home.css';
import '@/styles/customer-orders.css';
import '@/styles/customer-theme.css';
import '@/styles/customer-shipments.css';

type Filter = 'all' | 'on_the_road' | 'attention' | 'preparing' | 'delivered';

/** Customer portal: dispatch Egypt → Qatar shipments and follow each truck and its temperature. */
export default function CustomerShipmentsPage() {
  const { settings, update } = useTheme();
  const navigate = useNavigate();
  const isPhone = useIsMobile();
  const { customerProfile } = useAuth();
  const { unreadCount } = useNotifications();
  const lang = settings.language === 'ar' ? 'ar' : 'en';
  const L = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  const displayName = resolveCustomerDisplayName(customerProfile, lang) ?? '—';
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
    const c: Record<Filter, number> = { all: shipments.length, on_the_road: 0, attention: 0, preparing: 0, delivered: 0 };
    shipments.forEach((s) => (['on_the_road', 'attention', 'preparing', 'delivered'] as const).forEach((k) => { if (matches(s, k)) c[k] += 1; }));
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

  const chips: { key: Filter; en: string; ar: string; alert?: boolean }[] = [
    { key: 'all', en: 'All', ar: 'الكل' },
    { key: 'on_the_road', en: 'On the road', ar: 'في الطريق' },
    { key: 'attention', en: 'Needs attention', ar: 'تحتاج متابعة', alert: counts.attention > 0 },
    { key: 'preparing', en: 'Preparing', ar: 'قيد التجهيز' },
    { key: 'delivered', en: 'Delivered', ar: 'تم التسليم' },
  ];
  const tiles: { key: Exclude<Filter, 'all'>; cls: string; icon: typeof Truck; en: string; ar: string }[] = [
    { key: 'on_the_road', cls: 't3', icon: Truck, en: 'On the road', ar: 'في الطريق' },
    { key: 'attention', cls: counts.attention > 0 ? 'bad' : 't1', icon: AlertTriangle, en: 'Needs attention', ar: 'تحتاج متابعة' },
    { key: 'preparing', cls: 't2', icon: Clock, en: 'Preparing', ar: 'قيد التجهيز' },
    { key: 'delivered', cls: 't4', icon: CheckCircle2, en: 'Delivered', ar: 'تم التسليم' },
  ];
  const attentionCount = counts.attention;

  return (
    <div className="ch-root co-root cs-root" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      {isPhone && (
        <PortalHero
          lang={lang}
          displayName={displayName}
          unreadCount={unreadCount}
          onBell={() => navigate('/c/notifications')}
          onLanguage={(l) => update({ language: l })}
          icon={<Truck className="co-ttl-ic" strokeWidth={1.7} />}
          title={L('Shipments', 'الشحنات')}
          subtitle={L('Follow every truck from Egypt to Qatar', 'تابع كل شاحنة من مصر إلى قطر')}
          trendDown={attentionCount > 0}
          trendTitle={attentionCount > 0 ? L(`${attentionCount} need attention`, `${attentionCount} تحتاج متابعة`) : L('All on track', 'كل شيء على المسار')}
          trendText={attentionCount > 0 ? L('Check the trucks marked in red', 'راجع الشاحنات المعلّمة بالأحمر') : L(`${counts.on_the_road} on the road`, `${counts.on_the_road} في الطريق`)}
        />
      )}

      <div className="co-mainwrap">
        <div className="ch-card co-main">
          <div className="co-mtop">
            <div className="co-mlabel">{L('Status', 'الحالة')}</div>
            <button type="button" className="co-new" onClick={() => setShowNew(true)}>
              <Plus strokeWidth={2.2} />
              {L('New shipment', 'شحنة جديدة')}
            </button>
          </div>

          {shipments.length > 0 && (
            <>
              <div className="co-months">
                {chips.map((c) => (
                  <button key={c.key} type="button" aria-pressed={filter === c.key} onClick={() => setFilter(c.key)} className={cn('co-chip', filter === c.key && 'on', c.alert && 'alert')}>
                    {lang === 'ar' ? c.ar : c.en}<b>{counts[c.key]}</b>
                  </button>
                ))}
              </div>

              <div className="co-tools">
                <label className="cs-search">
                  <Search aria-hidden="true" />
                  <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={L('Search reference, cargo or driver', 'ابحث بالرقم أو الشحنة أو السائق')} aria-label={L('Search shipments', 'بحث في الشحنات')} />
                </label>
                <button type="button" className="co-tool" onClick={() => setShowDrivers(true)}><Users />{L('Drivers', 'السائقون')}</button>
              </div>

              <div className="co-tiles">
                {tiles.map((t) => (
                  <button key={t.key} type="button" aria-pressed={filter === t.key} onClick={() => setFilter(filter === t.key ? 'all' : t.key)} className={cn('co-t', t.cls, filter === t.key && 'on')}>
                    <div className="co-t-top"><span className="co-t-l">{lang === 'ar' ? t.ar : t.en}</span><span className="co-t-ic"><t.icon /></span></div>
                    <div className="co-t-v">{counts[t.key]}</div>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {isError && <p className="co-banner" role="alert" style={{ marginTop: 10, color: '#f0245b', fontSize: 12 }}>{L('Could not load shipments. Refresh the page or try again shortly.', 'تعذر تحميل الشحنات. حدّث الصفحة أو حاول بعد قليل.')}</p>}

      {isLoading && <div className="cs-list" aria-busy="true"><div className="cs-skel" /><div className="cs-skel" /></div>}

      {!isLoading && !isError && shipments.length === 0 && (
        <section className="ch-card cs-empty">
          <span className="ic"><PackageOpen aria-hidden="true" /></span>
          <h2>{L('No shipments yet', 'لا توجد شحنات بعد')}</h2>
          <p>{L('Dispatch your first truck from Egypt to Qatar. Your driver photographs the cooling unit’s screen along the way, and you see every reading here.', 'أرسل أول شاحنة من مصر إلى قطر. يصوّر السائق شاشة وحدة التبريد في الطريق وتشاهد كل قراءة هنا.')}</p>
          <div className="row">
            <button type="button" className="co-new" onClick={() => setShowNew(true)}><Plus strokeWidth={2.2} />{L('New shipment', 'شحنة جديدة')}</button>
            <button type="button" className="co-tool" onClick={() => setShowDrivers(true)}><User />{L('Add a driver first', 'أضف سائقاً أولاً')}</button>
          </div>
        </section>
      )}

      {!isLoading && shipments.length > 0 && (
        <>
          <div className="cs-head">
            <span>{filter === 'all' ? L('All shipments', 'كل الشحنات') : (lang === 'ar' ? chips.find((c) => c.key === filter)?.ar : chips.find((c) => c.key === filter)?.en)} <small>({visible.length})</small></span>
            {filter !== 'all' && <button type="button" onClick={() => setFilter('all')}>{L('Show all', 'عرض الكل')}</button>}
          </div>
          {visible.length === 0
            ? <p className="co-banner" style={{ marginTop: 12, fontSize: 12, color: '#6b7a9c', textAlign: 'center' }}>{L('No shipments match.', 'لا توجد شحنات مطابقة.')}</p>
            : <div className="cs-list">{visible.map((s) => <ShipmentCard key={s.id} shipment={s} lang={lang} now={now} onOpen={() => setOpenId(s.id)} />)}</div>}
        </>
      )}

      <ShipmentDetailSheet shipmentId={openId} lang={lang} now={now} onClose={() => setOpenId(null)} />
      <NewShipmentDialog open={showNew} onOpenChange={setShowNew} lang={lang} onManageDrivers={() => { setShowNew(false); setShowDrivers(true); }} onCreated={setOpenId} />
      <DriversDialog open={showDrivers} onOpenChange={setShowDrivers} lang={lang} />
    </div>
  );
}
