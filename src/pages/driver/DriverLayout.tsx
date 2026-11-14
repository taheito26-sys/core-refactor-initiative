import { NavLink, Outlet } from 'react-router-dom';
import { BarChart3, LogOut, Snowflake, Truck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/features/auth/auth-context';
import { LocationAccessCard } from '@/features/shipments/components/LocationAccessCard';
import { useDrivers } from '@/features/shipments/hooks';
import { useLocationAccess, type LocationAccess } from '@/features/shipments/useLocationAccess';
import { useTheme } from '@/lib/theme-context';
import { cn } from '@/lib/utils';

export interface DriverOutletContext {
  access: LocationAccess;
  driverName: string | null;
}

/**
 * The driver's whole app: a header with the driver's name, language and sign-out, the location status, one
 * task at a time, and two tabs at the bottom: shipments, and the driver's own month.
 */
export default function DriverLayout() {
  const { logout } = useAuth();
  const { settings, update } = useTheme();
  const lang = settings.language === 'ar' ? 'ar' : 'en';
  const L = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  const { data: drivers = [] } = useDrivers();
  const me = drivers[0];
  const access = useLocationAccess(lang);

  const tab = (to: string, label: string, Icon: typeof Truck) => (
    <NavLink
      to={to}
      className={({ isActive }) => cn('flex flex-1 flex-col items-center gap-1 py-2.5 text-sm font-semibold', isActive ? 'text-primary' : 'text-muted-foreground')}
    >
      <Icon className="h-6 w-6" aria-hidden="true" />
      {label}
    </NavLink>
  );

  return (
    <div className="min-h-screen bg-background text-foreground" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-border bg-background/95 px-4 py-3 backdrop-blur">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Snowflake className="h-5 w-5" aria-hidden="true" /></span>
          <span className="min-w-0">
            <span className="block truncate text-base font-bold">{me?.display_name ?? L('Driver', 'السائق')}</span>
            <span className="block truncate text-xs text-muted-foreground" dir="ltr">{me?.truck_plate ?? ''}</span>
          </span>
        </div>
        <div className="ms-auto flex items-center gap-2">
          <div className="inline-flex rounded-full border border-border p-0.5 text-xs font-bold" role="group" aria-label="Language">
            {(['ar', 'en'] as const).map((l) => (
              <button key={l} type="button" aria-pressed={lang === l} onClick={() => update({ language: l })} className={`rounded-full px-3 py-1.5 ${lang === l ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}>{l.toUpperCase()}</button>
            ))}
          </div>
          <Button variant="ghost" size="icon" onClick={() => logout()} aria-label={L('Sign out', 'تسجيل الخروج')}><LogOut className="h-5 w-5" aria-hidden="true" /></Button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-xl space-y-4 px-4 py-4 pb-28">
        <LocationAccessCard access={access} lang={lang} />
        <Outlet context={{ access, driverName: me?.display_name ?? null } satisfies DriverOutletContext} />
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur" aria-label={L('Driver menu', 'قائمة السائق')}>
        <div className="mx-auto flex max-w-xl">
          {tab('/d/shipments', L('Shipments', 'الشحنات'), Truck)}
          {tab('/d/stats', L('My month', 'شهري'), BarChart3)}
        </div>
      </nav>
    </div>
  );
}
