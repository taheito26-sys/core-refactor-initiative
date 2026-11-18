import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock, PackageOpen, Thermometer, Timer, Truck } from 'lucide-react';
import { useTheme } from '@/lib/theme-context';
import { cn } from '@/lib/utils';
import { ShipmentCard } from '@/features/shipments/components/ShipmentCard';
import { useShipments } from '@/features/shipments/hooks';
import { latestReading, readingDue } from '@/features/shipments/route';

const ORDER = { on_the_road: 0, preparing: 1, ended_early: 2, delivered: 3, cancelled: 4 } as const;

/** The driver's shipments: the one on the road first, then the ones waiting to start, then the finished ones. */
export default function DriverShipmentsPage() {
  const { settings } = useTheme();
  const navigate = useNavigate();
  const lang = settings.language === 'ar' ? 'ar' : 'en';
  const L = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  const { data: shipments = [], isLoading, isError } = useShipments();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(id); }, []);
  const sorted = useMemo(() => [...shipments].sort((a, b) => ORDER[a.status] - ORDER[b.status]), [shipments]);
  const count = (s: keyof typeof ORDER) => shipments.filter((x) => x.status === s).length;
  const active = shipments.filter((s) => s.status === 'on_the_road');
  const dueCount = active.filter((s) => {
    const due = readingDue(s, latestReading(s.readings)?.taken_at ?? null, now);
    return due.state === 'overdue' || due.state === 'due_soon';
  }).length;
  const alertCount = active.filter((s) => latestReading(s.readings)?.is_alert).length;

  return (
    <>
      {shipments.length > 0 && (
        <div className="co-mainwrap">
          <div className="ch-card co-main">
            <div className="co-mlabel">{L('Today', 'اليوم')}</div>
            <div className="co-tiles">
              <div className="co-t t3"><div className="co-t-top"><span className="co-t-l">{L('On the road', 'في الطريق')}</span><span className="co-t-ic"><Truck /></span></div><div className="co-t-v">{count('on_the_road')}</div></div>
              <div className={cn('co-t', dueCount > 0 ? 'bad' : 't2')}><div className="co-t-top"><span className="co-t-l">{L('Readings due', 'قراءات مستحقة')}</span><span className="co-t-ic"><Timer /></span></div><div className="co-t-v">{dueCount}</div></div>
              <div className={cn('co-t', alertCount > 0 ? 'bad' : 't4')}><div className="co-t-top"><span className="co-t-l">{L('Temp alerts', 'تنبيهات الحرارة')}</span><span className="co-t-ic"><Thermometer /></span></div><div className="co-t-v">{alertCount}</div></div>
              <div className="co-t t4"><div className="co-t-top"><span className="co-t-l">{L('Waiting', 'بانتظار البدء')}</span><span className="co-t-ic"><Clock /></span></div><div className="co-t-v">{count('preparing')}</div><div className="co-t-c">{count('delivered')} {L('delivered', 'تم تسليمها')}</div></div>
            </div>
          </div>
        </div>
      )}

      {isLoading && <div className="cs-list" aria-busy="true"><div className="cs-skel" /><div className="cs-skel" /></div>}
      {isError && <p className="co-banner" role="alert" style={{ marginTop: 10, color: '#f0245b', fontSize: 12 }}>{L('Could not load. Check your signal.', 'تعذر التحميل. تحقق من الإشارة.')}</p>}

      {!isLoading && !isError && sorted.length === 0 && (
        <section className="ch-card cs-empty">
          <span className="ic"><PackageOpen aria-hidden="true" /></span>
          <h2>{L('No shipments yet', 'لا توجد شحنات بعد')}</h2>
          <p>{L('When your customer assigns you a shipment it appears here.', 'عندما يعيّن لك العميل شحنة ستظهر هنا.')}</p>
        </section>
      )}

      {!isLoading && sorted.length > 0 && (
        <div className="cs-list">
          {sorted.map((s) => <ShipmentCard key={s.id} shipment={s} lang={lang} now={now} audience="driver" onOpen={() => navigate(`/d/shipments/${s.id}`)} />)}
        </div>
      )}
    </>
  );
}
