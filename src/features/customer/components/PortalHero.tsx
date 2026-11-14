import type { ReactNode } from 'react';
import { ArrowDownRight, ArrowUpRight, Bell, User } from 'lucide-react';
import { ZoomControls } from '@/components/shared/ZoomControls';

/**
 * The phone header the Orders and Cash pages share: zoom, notifications and language on top, the customer's
 * name, then the page title with a small status card. Same markup and classes as those pages (co-hero2).
 */
export function PortalHero({
  lang, displayName, unreadCount, onBell, extra, onLanguage, icon, title, subtitle, trendDown, trendTitle, trendText,
}: {
  lang: 'en' | 'ar';
  displayName: string;
  unreadCount?: number;
  /** Without it the bell is left out (the driver app has no notification centre). */
  onBell?: () => void;
  /** Extra controls placed after the language switch, such as sign out. */
  extra?: ReactNode;
  onLanguage: (lang: 'en' | 'ar') => void;
  icon: ReactNode;
  title: string;
  subtitle: string;
  trendDown: boolean;
  trendTitle: string;
  trendText: string;
}) {
  const L = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  return (
    <section className="co-hero2">
      <div className="co-hero2-bg" aria-hidden="true" />
      <div className="co-top">
        <ZoomControls variant="hero" label={L('Zoom', 'تكبير')} />
        <div className="co-ctl">
          {onBell && (
            <button type="button" className="ch-bell" onClick={onBell} aria-label={L('Notifications', 'التنبيهات')}>
              <Bell strokeWidth={2} />
              {(unreadCount ?? 0) > 0 && <span className="ch-badge">{(unreadCount ?? 0) > 9 ? '9+' : unreadCount}</span>}
            </button>
          )}
          <div className="ch-pill" role="group" aria-label={L('Language', 'اللغة')}>
            <button type="button" className={lang === 'ar' ? 'on' : ''} onClick={() => onLanguage('ar')}>AR</button>
            <button type="button" className={lang === 'en' ? 'on' : ''} onClick={() => onLanguage('en')}>EN</button>
          </div>
          {extra}
        </div>
      </div>
      <div className="co-idrow">
        <div className="co-who">
          <div className="ch-avatar"><User fill="#fff" stroke="#fff" /></div>
          <div>
            <div className="ch-name">{displayName}</div>
            <div className="ch-greet">{L('Welcome to your dashboard', 'مرحباً بك في لوحة التحكم')}</div>
          </div>
        </div>
      </div>
      <div className="co-head">
        <div className="co-ttl">
          <div className="co-ttl-row">
            {icon}
            <h1>{title}</h1>
          </div>
          <p>{subtitle}</p>
        </div>
        <div className="co-grow">
          <svg className="co-grow-ic" viewBox="0 0 16 18" aria-hidden="true">
            <defs><linearGradient id="co-gbars" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stopColor="#22c58b" /><stop offset="1" stopColor="#3b82f6" /></linearGradient></defs>
            <rect x="0" y="11" width="3" height="7" rx="1" fill="url(#co-gbars)" />
            <rect x="4.3" y="7" width="3" height="11" rx="1" fill="url(#co-gbars)" />
            <rect x="8.6" y="4" width="3" height="14" rx="1" fill="url(#co-gbars)" />
            <rect x="12.9" y="0" width="3" height="18" rx="1" fill="url(#co-gbars)" />
          </svg>
          <div>
            <b>{trendTitle}</b>
            <span>{trendText}</span>
          </div>
          {trendDown ? <ArrowDownRight className="co-grow-arrow down" strokeWidth={2.4} /> : <ArrowUpRight className="co-grow-arrow" strokeWidth={2.4} />}
        </div>
      </div>
    </section>
  );
}
