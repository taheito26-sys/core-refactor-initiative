import type { CSSProperties, ReactNode } from 'react';
import {
  ArrowDown, ArrowDownRight, ArrowUpRight, Bell, CalendarDays, ChevronLeft, ChevronRight, Clock,
  Database, FileText, Info, Landmark, List, Plus, ReceiptText, TrendingUp, User, UserPlus, Wallet,
} from 'lucide-react';
import '@/styles/customer-home.css';
import { chartPoints, formatActivityStamp, formatPaymentStamp, smoothPath, sparkPath, type ActivityRow, type RateTrend } from './home-model';

export interface HomeSettlement { total: number; paid: number; remaining: number; pct: number; count: number; avg: number; lastTs: number | null }

export interface CustomerHomeViewProps {
  lang: 'en' | 'ar';
  name: string;
  unread: number;
  emergency: { value: number | null; trend: RateTrend };
  average: { value: number | null; trend: RateTrend };
  settlement: HomeSettlement | null;
  volume: { egp: number; qar: number; fx: number | null; daily: number[] };
  tiles: { week: number; month: number; total: number };
  activity: ActivityRow[];
  /** Number formatter: amount, decimals. */
  fmt: (value: number, digits?: number) => string;
  currencyQar: string;
  currencyEgp: string;
  onNavigate: (path: string) => void;
  onNewOrder: () => void;
  onSetLang: (lang: 'en' | 'ar') => void;
  onOpenMenu?: () => void;
  onToggleEmergencyInfo: () => void;
  /** Alerts and notes that sit between the hero and the first card. */
  belowHero?: ReactNode;
}

const L = (lang: 'en' | 'ar', en: string, ar: string) => (lang === 'ar' ? ar : en);

function CoinStack() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="12" cy="6" rx="7" ry="3" /><path d="M5 6v4c0 1.7 3.1 3 7 3s7-1.3 7-3V6" /><path d="M5 10v4c0 1.7 3.1 3 7 3s7-1.3 7-3v-4" /><path d="M5 14v4c0 1.7 3.1 3 7 3s7-1.3 7-3v-4" />
    </svg>
  );
}
function CoinsTwo() {
  return (
    <svg viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="9" cy="17" rx="5.500" ry="2.400" /><path d="M3.500 17v3c0 1.300 2.500 2.400 5.500 2.400s5.500-1.100 5.500-2.400v-3" /><path d="M3.500 20v3c0 1.300 2.500 2.400 5.500 2.400s5.500-1.100 5.500-2.400v-3" />
      <ellipse cx="19" cy="9" rx="5.500" ry="2.400" /><path d="M13.500 9v3c0 1.300 2.500 2.400 5.500 2.400s5.500-1.100 5.500-2.400V9" /><path d="M13.500 12v3c0 1.300 2.500 2.400 5.500 2.400s5.500-1.100 5.500-2.400v-3" /><path d="M13.500 15v1.500" />
    </svg>
  );
}
function Bars4() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
      <path d="M4.500 19v-3.500M9.500 19v-7M14.500 19V8M19.500 19V4.500" />
    </svg>
  );
}
function TargetArrow() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21.2 12.200A9.200 9.200 0 1 1 11.800 2.800" /><path d="M16.400 12A4.400 4.400 0 1 1 12 7.600" /><circle cx="12" cy="12" r=".9" fill="currentColor" /><path d="m13 11 7.500-7.500M16.500 3.500h4v4M20.500 3.500" />
    </svg>
  );
}
function SolidWallet() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 7.5 14.5 4l.6 2H6.2L4 7.5Z" opacity=".75" /><rect x="3" y="7" width="18" height="13" rx="3" /><circle cx="16.5" cy="13.5" r="1.6" fill="#5a73e6" /></svg>
  );
}
function ChatCheck() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" /><path d="m8.5 11.5 2.6 2.6 4.4-4.6" />
    </svg>
  );
}
function AverageGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 15c1.5-5 3-8 4.6-8 1.2 0 1.2 2.5.2 5.5-.8 2.5-.4 3.5 1 3.5s2.6-3 3.2-8" /><path d="M16.5 4.5v11.5c0 2.2 1.7 3.5 4 3" />
    </svg>
  );
}

function RateSpark({ trend, up, w, h }: { trend: RateTrend; up: boolean; w: number; h: number }) {
  return (
    <svg viewBox={`0 0 ${w} ${h}`} fill="none" stroke={up ? '#3de3b0' : '#ff8da1'} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d={sparkPath(trend.points, w, h)} />
    </svg>
  );
}

const CHART_XS = [32, 76, 137, 202, 265, 320, 388, 447];
const DOTS: Array<{ r: number; fill: string }> = [
  { r: 3.5, fill: '#3de3b0' }, { r: 5.2, fill: '#3de3b0' }, { r: 6, fill: '#ffffff' }, { r: 6, fill: '#c9f7ea' },
  { r: 6, fill: '#ffffff' }, { r: 5.4, fill: '#3de3b0' }, { r: 6, fill: '#ffffff' }, { r: 6.4, fill: '#ffffff' },
];

function MonthChart({ daily }: { daily: number[] }) {
  const pts = chartPoints(daily, CHART_XS, 61, 169);
  const line = [{ x: 0, y: 169 }, ...pts];
  const d = smoothPath(line) + ` L${pts[pts.length - 1].x + 45} ${pts[pts.length - 1].y}`;
  const area = `${d} L${pts[pts.length - 1].x + 45} 169 L0 169 Z`;
  return (
    <svg className="chart" viewBox="0 0 502 185" aria-hidden="true">
      <defs>
        <linearGradient id="chFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#35d9b0" stopOpacity=".42" /><stop offset="1" stopColor="#35d9b0" stopOpacity="0" /></linearGradient>
        <linearGradient id="chFade" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#fff" /><stop offset=".86" stopColor="#fff" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></linearGradient>
        <mask id="chMask"><rect x="0" y="0" width="502" height="185" fill="url(#chFade)" /></mask>
      </defs>
      <g mask="url(#chMask)">
        <path d={area} fill="url(#chFill)" />
        {pts.map((p, i) => <line key={i} x1={p.x} x2={p.x} y1={p.y} y2={169} stroke="rgba(130,200,225,.16)" strokeWidth="1" />)}
        <line x1="0" x2="502" y1="169" y2="169" stroke="rgba(130,170,230,.2)" strokeWidth="1" />
        <path d={d} fill="none" stroke="#38e1b2" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      {pts.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={DOTS[i].r} fill={DOTS[i].fill} />)}
    </svg>
  );
}

type Place = { s?: number; e?: number; top: number; w?: number };
const at = (p: Place): CSSProperties => ({
  top: `calc(${p.top} * var(--u))`,
  ...(p.s != null ? { insetInlineStart: `calc(${p.s} * var(--u))` } : {}),
  ...(p.e != null ? { insetInlineEnd: `calc(${p.e} * var(--u))` } : {}),
  ...(p.w != null ? { width: `calc(${p.w} * var(--u))` } : {}),
});

export function CustomerHomeView(p: CustomerHomeViewProps) {
  const { lang, fmt } = p;
  const t = (en: string, ar: string) => L(lang, en, ar);
  const unit = lang === 'ar' ? 'ر.ق' : 'QAR';
  const Chev = lang === 'ar' ? ChevronLeft : ChevronRight;

  const actions: Array<{ key: string; label: string; icon: ReactNode; bg: string; color: string; go: () => void; c: number }> = [
    { key: 'new', label: t('New Order', 'طلب جديد'), icon: <Plus strokeWidth={2.1} />, bg: '#f0edfe', color: '#5b3fe0', go: p.onNewOrder, c: 94.5 },
    { key: 'orders', label: t('Orders', 'الطلبات'), icon: <List strokeWidth={2.3} />, bg: '#e3effe', color: '#1f6bf3', go: () => p.onNavigate('/c/orders'), c: 287 },
    { key: 'wallet', label: t('Wallet', 'المحفظة'), icon: <Wallet strokeWidth={1.9} />, bg: '#e6f8f1', color: '#16a673', go: () => p.onNavigate('/c/wallet'), c: 474 },
    { key: 'connect', label: t('Connect', 'بادر'), icon: <UserPlus strokeWidth={2} />, bg: '#fdf3e3', color: '#f59a0b', go: () => p.onNavigate('/c/merchants'), c: 659 },
    { key: 'chat', label: t('Chat', 'الدردشة'), icon: <ChatCheck />, bg: '#f0ecfd', color: '#7a45e0', go: () => p.onNavigate('/c/chat'), c: 848 },
  ];
  const dividers = [193, 378, 568, 753];

  const rateCard = (cls: 'green' | 'blue', title: string, value: number | null, trend: RateTrend, tile: ReactNode, info?: boolean) => (
    <div className={`ch-rate ${cls}`}>
      <div className="ch-rate-tile">{tile}</div>
      <div className="ch-abs ch-rate-title">
        <span>{title}</span>
        {info && (
          <button type="button" className="ch-rate-info" onClick={p.onToggleEmergencyInfo} aria-label={t('How this price is built', 'كيف يُحسب هذا السعر')}><Info /></button>
        )}
      </div>
      <div className="ch-abs ch-rate-num">{value != null ? fmt(value, 4) : '—'}</div>
      <div className="ch-abs ch-rate-unit">{unit}</div>
      <div className={`ch-abs ch-rate-chg ${trend.up ? '' : 'down'}`}>
        <span className="in">
          {trend.up ? <ArrowUpRight /> : <ArrowDownRight />}
          <b>{trend.up ? '+' : '-'}{Math.abs(trend.pct).toFixed(2)}%</b>
        </span>
      </div>
      <div className="ch-rate-spark"><RateSpark trend={trend} up={trend.up} w={cls === 'green' ? 25 : 34} h={cls === 'green' ? 12 : 13} /></div>
    </div>
  );

  const s = p.settlement;
  const statCol = (icon: ReactNode, bg: string, color: string, iconS: number, textE: number, value: string, label: string, date = false) => (
    <>
      <div className="ch-stat-ic" style={{ ...at({ s: iconS, top: 11.5 }), background: bg, color }}>{icon}</div>
      <div className="ch-stat-txt" style={at({ e: textE, top: 8 })}>
        <div className={`ch-stat-val ${date ? 'date' : ''}`}>{value}</div>
        <div className="ch-stat-lbl">{label}</div>
      </div>
    </>
  );
  const setCol = (icon: ReactNode, bg: string, color: string, iconS: number, textE: number, numColor: string, value: string, label: string) => (
    <>
      <div className="ch-set-ic" style={{ ...at({ s: iconS, top: 20 }), background: bg, color }}>{icon}</div>
      <div className="ch-set-txt" style={at({ e: textE, top: 19 })}>
        <div className="ch-set-num" style={{ color: numColor }}>{value}</div>
        <div className="ch-set-lbl">{label}</div>
      </div>
    </>
  );

  const rowTitle = (r: ActivityRow) => (r.kind === 'received' ? t('Payment received', 'استلام دفعة') : r.kind === 'paid' ? t('Dues payment', 'دفع مستحقات') : t('New order', 'طلب جديد'));
  const rowSub = (r: ActivityRow) => (r.kind === 'new' ? (r.currency === 'EGP' ? p.currencyEgp : r.currency ?? p.currencyEgp) : t('Bank transfer', 'تحويل بنكي'));
  const rowIcon = (r: ActivityRow) => (r.kind === 'received' ? <Landmark strokeWidth={2.2} /> : r.kind === 'new' ? <FileText strokeWidth={2.2} /> : <Wallet strokeWidth={2.2} />);
  const rowPill = (r: ActivityRow) => (r.cancelled ? t('Cancelled', 'ملغي') : r.status === 'proc' ? t('Processing', 'قيد المعالجة') : t('Completed', 'مكتمل'));

  return (
    <div className="ch-root" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      {/* Hero: header controls, greeting and the two live rates */}
      <section className="ch-hero">
        <div className="ch-hero-bg" aria-hidden="true" />

        <div className="ch-pill" role="group" aria-label={t('Language', 'اللغة')}>
          <div className="in">
            <button type="button" className={p.lang === 'ar' ? 'on' : ''} onClick={() => p.onSetLang('ar')}>AR</button>
            <button type="button" className={p.lang === 'en' ? 'on' : ''} onClick={() => p.onSetLang('en')}>EN</button>
          </div>
        </div>
        <button type="button" className="ch-bell" onClick={() => p.onNavigate('/c/notifications')} aria-label={t('Notifications', 'التنبيهات')}>
          <Bell strokeWidth={2} />
        </button>
        {p.unread > 0 && <span className="ch-badge" style={{ insetInlineEnd: 'calc(236 * var(--u))', top: 'calc(13 * var(--u))' }}>{p.unread > 9 ? '9+' : p.unread}</span>}
        {p.onOpenMenu && (
          <button type="button" className="ch-burger" onClick={p.onOpenMenu} aria-label={t('Menu', 'القائمة')}>
            <svg viewBox="0 0 25 22" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><path d="M1 3h23M1 11h23M1 19h23" /></svg>
          </button>
        )}
        <div className="ch-avatar"><User fill="#fff" stroke="#fff" /></div>
        <div className="ch-abs ch-name">{p.name}</div>
        <div className="ch-abs ch-greet">{t('Welcome to your dashboard', 'مرحباً بك في لوحة التحكم')}</div>
        <div className="ch-tag">{t('Every number here', 'كل رقم هنا')}<br />{t('brings you closer to your goal', 'يُقرِّبك من هدفك')}</div>
        <svg className="ch-tag-ic" viewBox="0 0 40 32" fill="none" stroke="currentColor" strokeWidth="4.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 27 14 15l7 6 14-15" /><path d="M24 5h11v11" /></svg>

        {rateCard('blue', t('Avg Selling Price', 'متوسط سعر البيع'), p.average.value, p.average.trend, <SolidWallet />)}
        {rateCard('green', t('Emergency Price', 'سعر الطوارئ'), p.emergency.value, p.emergency.trend, <CoinsTwo />, true)}
      </section>

      {p.belowHero}

      {/* Quick actions */}
      <section className="ch-card ch-actions">
        {dividers.map(x => <div key={x} className="ch-act-div" style={at({ s: x, top: 25 })} />)}
        {actions.map(a => (
          <button key={a.key} type="button" className="ch-act" style={at({ s: a.c - 95, top: 0 })} onClick={a.go}>
            <span className="ch-act-tile" style={{ background: a.bg, color: a.color }}>{a.icon}</span>
            <span className="ch-act-label">{a.label}</span>
          </button>
        ))}
      </section>

      {/* Settlement summary */}
      {s && (
        <section className="ch-card ch-settle">
          {setCol(<FileText strokeWidth={2.2} />, '#e6f0fe', '#1760f0', 216, 752, '#1760f0', p.fmt(s.total), t('Total Debt', 'إجمالي المستحقات'))}
          <div className="ch-set-div" style={at({ s: 309, top: 20 })} />
          {setCol(<TrendingUp strokeWidth={2.2} />, '#e9f9f4', '#0b8a68', 550, 419, '#0b8a68', p.fmt(s.paid), t('Paid', 'المدفوع'))}
          <div className="ch-set-div" style={at({ s: 640, top: 20 })} />
          {setCol(<ArrowDown strokeWidth={1.8} />, '#ffedf2', '#f0245b', 861, 109, '#f0245b', p.fmt(s.remaining), t('Remaining', 'المتبقي'))}

          <div className="ch-mint">
            <div className="ch-abs ch-mint-pct">{s.pct}%</div>
            <div className="ch-abs ch-mint-lbl">{t('Settlement', 'نسبة التسوية')}</div>
            <div className="ch-track"><div className="in"><i style={{ width: `${s.pct}%` }} /></div></div>
          </div>

          {s.count > 0 && (
            <div className="ch-stats">
              <div className="ch-stat-div" style={at({ s: 602.5, top: 3.5 })} />
              <div className="ch-stat-div" style={at({ s: 260, top: 3.5 })} />
              {statCol(<ReceiptText strokeWidth={2.2} />, '#dcecfd', '#1f63f0', 184, 747.5, String(s.count), t('Payments', 'الدفعات'))}
              {statCol(<AverageGlyph />, '#ece8fe', '#7c3aed', 525, 409, p.fmt(s.avg), t('Average', 'المتوسط'))}
              {statCol(<CalendarDays strokeWidth={2.2} />, '#dcf3ea', '#0b8a68', 838.5, 83, s.lastTs != null ? formatPaymentStamp(s.lastTs, lang) : '—', t('Last Payment', 'آخر دفعة'), true)}
            </div>
          )}
        </section>
      )}

      {/* This month's delivered volume */}
      <section className="ch-vol">
        <MonthChart daily={p.volume.daily} />
        {p.volume.fx != null && (
          <div className="ch-vol-chip"><div className="in"><ArrowUpRight /><b>{p.fmt(p.volume.fx, 2)}</b><span>{unit}</span></div></div>
        )}
        <div className="ch-abs ch-vol-l1">{p.currencyQar} → {p.currencyEgp} {'•'} {t('This Month', 'هذا الشهر')}</div>
        <div className="ch-abs ch-vol-l2">{t('Delivered (EGP)', 'مُسلَّم (جنيه)')}</div>
        <div className="ch-abs ch-vol-amt">{p.fmt(p.volume.egp)}</div>
        <div className="ch-vol-ic"><CoinStack /></div>
        <div className="ch-abs ch-vol-l3">{t('from', 'من')} <b>{p.fmt(p.volume.qar)}</b> {p.currencyQar} {t('received', 'مستلم')}</div>
      </section>

      {/* Week / month / total */}
      <section className="ch-card ch-tiles">
        <div className="ch-tile week">
          <div className="ch-tile-ic"><Bars4 /></div>
          <div className="ch-abs ch-tile-lbl">{t('This Week', 'هذا الأسبوع')}</div>
          <div className="ch-abs ch-tile-val"><div className="in"><b>{p.fmt(p.tiles.week)}</b><span>{unit}</span></div></div>
        </div>
        <div className="ch-tile month">
          <div className="ch-tile-ic"><TargetArrow /></div>
          <div className="ch-abs ch-tile-lbl">{t('This Month', 'هذا الشهر')}</div>
          <div className="ch-abs ch-tile-val"><div className="in"><b>{p.fmt(p.tiles.month)}</b><span>{unit}</span></div></div>
        </div>
        <div className="ch-tile total">
          <div className="ch-tile-ic"><Database strokeWidth={2} /></div>
          <div className="ch-abs ch-tile-lbl">{t('Total Value', 'القيمة الإجمالية')}</div>
          <div className="ch-abs ch-tile-val"><div className="in"><b>{p.fmt(p.tiles.total)}</b><span>{unit}</span></div></div>
        </div>
      </section>

      {/* Latest activity */}
      <section className="ch-card ch-act-card">
        <Clock className="ch-head-ic" strokeWidth={2.2} />
        <div className="ch-abs ch-head-t">{t('Latest Activity', 'أحدث النشاطات')}</div>
        <button type="button" className="ch-all" onClick={() => p.onNavigate('/c/orders')}><span className="in"><Chev strokeWidth={2.6} /><span>{t('View all', 'عرض الكل')}</span></span></button>
        <div className="ch-hr" style={at({ s: 20, top: 52 })} />
        {p.activity.length === 0 && <div className="ch-empty">{t('No activity yet', 'لا توجد أنشطة بعد')}</div>}
        {p.activity.map((r, i) => (
          <button key={r.id} type="button" className="ch-row" style={{ top: `calc(${53.5 + i * 57.5} * var(--u))` }}
            onClick={() => p.onNavigate(r.orderId ? `/c/orders?id=${r.orderId}` : '/c/wallet')}>
            <span className={`ch-row-ic ${r.kind === 'received' ? '' : r.kind === 'new' ? 'blue' : ''}`}>{rowIcon(r)}</span>
            <span className="ch-abs ch-row-t">{rowTitle(r)}</span>
            <span className="ch-abs ch-row-s">{rowSub(r)}</span>
            <span className="ch-abs ch-row-d">{formatActivityStamp(r.ts, lang)}</span>
            <span className={`ch-abs ch-row-a ${r.sign === '+' ? 'pos' : 'neg'}`}><bdi>{r.sign} {p.fmt(r.amount)}</bdi></span>
            <span className={`ch-row-p ${r.status}`}>{rowPill(r)}</span>
            {i < p.activity.length - 1 && <span className="ch-hr" style={{ ...at({ s: 20, top: 56 }) }} />}
          </button>
        ))}
      </section>
    </div>
  );
}

