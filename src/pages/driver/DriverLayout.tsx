import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { BarChart3, LogOut, Truck } from 'lucide-react';
import { useAuth } from '@/features/auth/auth-context';
import { PortalHero } from '@/features/customer/components/PortalHero';
import { LocationAccessCard } from '@/features/shipments/components/LocationAccessCard';
import { useDrivers } from '@/features/shipments/hooks';
import { useLocationAccess, type LocationAccess } from '@/features/shipments/useLocationAccess';
import { useTheme } from '@/lib/theme-context';
import { cn } from '@/lib/utils';
import '@/styles/customer-home.css';
import '@/styles/customer-orders.css';
import '@/styles/customer-theme.css';
import '@/styles/customer-shipments.css';

export interface DriverOutletContext {
  access: LocationAccess;
  driverName: string | null;
}

/**
 * The driver's whole app, in the portal's design: the header with the driver's name and truck, the location
 * state, one page at a time, and a bottom bar with two tabs: shipments, and the driver's own month.
 */
export default function DriverLayout() {
  const { logout } = useAuth();
  const { settings, update } = useTheme();
  const location = useLocation();
  const lang = settings.language === 'ar' ? 'ar' : 'en';
  const L = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  const { data: drivers = [] } = useDrivers();
  const me = drivers[0];
  const access = useLocationAccess(lang);
  const onStats = location.pathname.startsWith('/d/stats');
  const locationOn = access.permission === 'granted';

  const tab = (to: string, label: string, Icon: typeof Truck) => (
    <NavLink to={to} className={({ isActive }) => cn('ch-nav-item', isActive && 'on')}>
      <span className="ch-nav-ic"><Icon strokeWidth={1.7} aria-hidden="true" /></span>
      <span className="ch-nav-lbl">{label}</span>
    </NavLink>
  );

  return (
    <div className="ch-root co-root cs-root" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <PortalHero
        lang={lang}
        displayName={me?.display_name ?? L('Driver', 'السائق')}
        onLanguage={(l) => update({ language: l })}
        extra={<button type="button" className="ch-bell" onClick={() => logout()} aria-label={L('Sign out', 'تسجيل الخروج')}><LogOut strokeWidth={2} /></button>}
        icon={onStats ? <BarChart3 className="co-ttl-ic" strokeWidth={1.7} /> : <Truck className="co-ttl-ic" strokeWidth={1.7} />}
        title={onStats ? L('My month', 'شهري') : L('My shipments', 'شحناتي')}
        subtitle={onStats ? L('Your trips and your temperature record', 'رحلاتك وسجل الحرارة') : (me?.truck_plate ? `${L('Truck', 'الشاحنة')} ${me.truck_plate}` : L('Photograph the unit’s screen on time', 'صوّر شاشة الوحدة في موعدها'))}
        trendDown={access.permission !== 'granted' && access.permission !== 'checking'}
        trendTitle={locationOn ? L('Location is on', 'الموقع مفعّل') : L('Location is off', 'الموقع غير مفعّل')}
        trendText={locationOn ? L('Photos are stamped with it', 'تُختم به الصور') : L('Allow it to send readings', 'اسمح به لإرسال القراءات')}
      />

      <Outlet context={{ access, driverName: me?.display_name ?? null } satisfies DriverOutletContext} />

      <nav className="ch-nav dr-nav" dir={lang === 'ar' ? 'rtl' : 'ltr'} aria-label={L('Driver menu', 'قائمة السائق')}>
        <div className="ch-nav-in">
          {tab('/d/shipments', L('Shipments', 'الشحنات'), Truck)}
          {tab('/d/stats', L('My month', 'شهري'), BarChart3)}
        </div>
      </nav>
    </div>
  );
}
