import { Outlet, Link } from 'react-router-dom';
import { LogOut, Snowflake } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/features/auth/auth-context';
import { useDrivers } from '@/features/shipments/hooks';
import { useTheme } from '@/lib/theme-context';

/** The driver's whole app: a header with the driver's name, language and sign-out, and one task at a time below it. */
export default function DriverLayout() {
  const { logout } = useAuth();
  const { settings, update } = useTheme();
  const lang = settings.language === 'ar' ? 'ar' : 'en';
  const { data: drivers = [] } = useDrivers();
  const me = drivers[0];

  return (
    <div className="min-h-screen bg-background text-foreground" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-border bg-background/95 px-4 py-3 backdrop-blur">
        <Link to="/d/shipments" className="flex min-w-0 items-center gap-2">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Snowflake className="h-5 w-5" aria-hidden="true" /></span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-bold">{me?.display_name ?? (lang === 'ar' ? 'السائق' : 'Driver')}</span>
            <span className="block truncate text-xs text-muted-foreground" dir="ltr">{me?.truck_plate ?? ''}</span>
          </span>
        </Link>
        <div className="ms-auto flex items-center gap-2">
          <div className="inline-flex rounded-full border border-border p-0.5 text-xs font-bold" role="group" aria-label="Language">
            {(['ar', 'en'] as const).map((l) => (
              <button key={l} type="button" aria-pressed={lang === l} onClick={() => update({ language: l })} className={`rounded-full px-2.5 py-1 ${lang === l ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}>{l.toUpperCase()}</button>
            ))}
          </div>
          <Button variant="ghost" size="icon" onClick={() => logout()} aria-label={lang === 'ar' ? 'تسجيل الخروج' : 'Sign out'}><LogOut className="h-4 w-4" aria-hidden="true" /></Button>
        </div>
      </header>
      <main className="mx-auto w-full max-w-xl px-4 py-4 pb-16"><Outlet /></main>
    </div>
  );
}
