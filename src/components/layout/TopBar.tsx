import { useLocation } from 'react-router-dom';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Menu, Bell, Users, TrendingUp, User, Search, Filter } from 'lucide-react';
import { useDashboardFilters } from '@/features/dashboard/dashboard-filters';
import ActivityCenter from '@/components/notifications/ActivityCenter';
import { useTheme } from '@/lib/theme-context';
import { useT } from '@/lib/i18n';
import { useAuth } from '@/features/auth/auth-context';
import { cn } from '@/lib/utils';
import { ZoomControls } from '@/components/shared/ZoomControls';
import { UserProfileModal } from '@/features/profile/UserProfileModal';
import { useHomeDesign } from '@/features/orders/v2/design';
import { LayoutSwitch } from '@/features/orders/v2/LayoutSwitch';
import { ThemeColorPicker } from './ThemeColorPicker';

function titleFromPath(pathname: string, t: ReturnType<typeof useT>): { title: string; subtitle: string } {
  if (pathname === '/dashboard') return { title: t('dashboard'), subtitle: t('dashboardSub') };
  if (pathname === '/trading/orders') return { title: t('orders'), subtitle: t('tradesSub') };
  if (pathname === '/trading/stock') return { title: t('stock'), subtitle: t('stockSub') };
  if (pathname === '/trading/calendar') return { title: t('calendar'), subtitle: t('calendarSub') };
  if (pathname === '/trading/p2p') return { title: t('p2pTracker'), subtitle: 'Live market rates' };
  if (pathname === '/crm') return { title: t('crm'), subtitle: t('crmSub') };
  if (pathname === '/merchants') return { title: t('theMerchants'), subtitle: 'Relationships, deals & invitations' };
  if (pathname === '/deals') return { title: t('deals'), subtitle: 'Deal management' };
  if (pathname === '/analytics') return { title: t('analytics'), subtitle: 'Performance insights' };
  if (pathname === '/vault') return { title: t('vault'), subtitle: 'Document storage' };
  if (pathname === '/settings') return { title: t('settings'), subtitle: t('layoutThemesData') };
  if (pathname === '/notifications') return { title: t('notifications'), subtitle: 'Activity feed' };
  return { title: 'The Tracker', subtitle: 'P2P Trading Platform' };
}

const RANGES = [
  { id: 'today', label: '1D' },
  { id: '7d', label: '7D' },
  { id: 'this_month', label: '30D' },
  { id: 'all', label: 'ALL' },
] as const;

type TopBarProps = {
  isMobile?: boolean;
  onMenuClick?: () => void;
};

export function TopBar({ isMobile = false, onMenuClick }: TopBarProps) {
  const location = useLocation();
  const { settings, update } = useTheme();
  const { merchantProfile, logout } = useAuth();
  const t = useT();
  const meta = useMemo(() => titleFromPath(location.pathname, t), [location.pathname, t]);
  const [profileOpen, setProfileOpen] = useState(false);
  // On the phone dashboard the bar carries search and filter buttons, and the zoom control moves into the filter sheet.
  const onPhoneDashboard = isMobile && location.pathname === '/dashboard';
  const { setSearchOpen, setFilterOpen, scope, customFrom } = useDashboardFilters();
  const dashFiltersActive = scope !== 'all' || !!customFrom;
  // The New | Classic choice for every page lives here, on the home page only.
  const onHome = location.pathname === '/dashboard';
  const [design, setDesign] = useHomeDesign();
  // On a phone every control shares one line, so each is drawn small; the bar also ignores the app zoom (app-topbar).
  const pillCls = cn('rounded font-semibold transition-all md:px-2.5 md:text-[11px]', isMobile ? 'px-[3px] py-[3px] text-[8.5px] leading-none' : 'px-1.5 py-1 text-[10px]');

  // ── Phone: the controls always span the bar edge to edge ──
  // The row is drawn at its natural size and then scaled so its width is exactly the bar's, whatever the app zoom
  // (already divided out by app-topbar) or how many controls this page shows: fewer controls are drawn larger.
  const headerRef = useRef<HTMLElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(1);
  useLayoutEffect(() => {
    if (!isMobile) return undefined;
    const header = headerRef.current;
    const row = rowRef.current;
    if (!header || !row) return undefined;
    const measure = () => {
      const cs = getComputedStyle(header);
      const avail = header.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      setFit(prev => {
        const natural = row.getBoundingClientRect().width / prev;
        if (!(natural > 0) || !(avail > 0)) return prev;
        const next = Math.max(0.6, Math.min(2.2, avail / natural));
        return Math.abs(next - prev) < 0.004 ? prev : next;
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(header);
    ro.observe(row);
    return () => ro.disconnect();
  }, [isMobile, location.pathname, settings.language, settings.currency, design]);

  return (
    <header
      ref={headerRef}
      className={cn('app-topbar sticky top-0 z-20 flex items-center bg-background/95 backdrop-blur-sm', isMobile ? 'flex-nowrap gap-[2px] px-1 py-1' : 'gap-1 md:gap-2 px-2 md:px-3 py-1.5', onPhoneDashboard ? '' : 'border-b border-border')}
      style={isMobile ? {
        paddingTop: 'calc(env(safe-area-inset-top, 0px) + 5px)',
        paddingLeft: 'max(4px, env(safe-area-inset-left, 0px))',
        paddingRight: 'max(4px, env(safe-area-inset-right, 0px))',
      } : undefined}
    >
      <div ref={rowRef} className={isMobile ? 'flex w-max shrink-0 flex-nowrap items-center gap-[2px]' : 'contents'} style={isMobile ? { zoom: fit } : undefined}>
      {isMobile && onMenuClick && (
        <button onClick={onMenuClick} className="order-[-2] p-[3px] rounded-md hover:bg-muted text-muted-foreground shrink-0">
          <Menu className="h-4 w-4" />
        </button>
      )}

      {/* ── Period Toggle ── */}
      <div className="flex shrink-0 items-center gap-0 bg-muted rounded-md p-[2px]">
        {RANGES.map(r => (
          <button
            key={r.id}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            onClick={() => update({ range: r.id as any })}
            className={cn(
              pillCls,
              settings.range === r.id
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {r.label}
          </button>
        ))}
      </div>

      {/* ── Currency and language: one tap-to-switch button each on a phone, both choices side by side elsewhere ── */}
      {isMobile && (
        <>
          <button
            type="button"
            onClick={() => { const c = settings.currency === 'USDT' ? 'QAR' : 'USDT'; update({ currency: c, ...(c !== 'USDT' ? { baseFiatCurrency: c } : {}) }); }}
            title="QAR / USDT"
            className={cn(pillCls, 'shrink-0 bg-primary text-primary-foreground shadow-sm')}
          >
            {settings.currency}
          </button>
          <button
            type="button"
            onClick={() => update({ language: settings.language === 'ar' ? 'en' : 'ar' })}
            title={`${t('arabic')} / ${t('english')}`}
            className={cn(pillCls, 'shrink-0 bg-muted text-foreground')}
          >
            {settings.language === 'ar' ? 'AR' : 'EN'}
          </button>
        </>
      )}

      {/* ── Currency Toggle ── */}
      {!isMobile && <div className="flex shrink-0 items-center gap-0 bg-muted rounded-md p-[2px]">
        {(['QAR', 'USDT'] as const).map(c => (
          <button
            key={c}
            onClick={() => update({ currency: c, ...(c !== 'USDT' ? { baseFiatCurrency: c } : {}) })}
            className={cn(
              pillCls,
              settings.currency === c
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {c}
          </button>
        ))}
      </div>}

      {/* ── Language Toggle ── */}
      {!isMobile && <div className="flex shrink-0 items-center gap-0 bg-muted rounded-md p-[2px]">
        <button
          onClick={() => update({ language: 'ar' })}
          className={cn(
            pillCls,
            settings.language === 'ar'
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          <span className="md:hidden">AR</span>
          <span className="hidden md:inline">{t('arabic')}</span>
        </button>
        <button
          onClick={() => update({ language: 'en' })}
          className={cn(
            pillCls,
            settings.language === 'en'
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          <span className="md:hidden">EN</span>
          <span className="hidden md:inline">{t('english')}</span>
        </button>
      </div>}

      {/* ── Colours of the current layout ── */}
      <ThemeColorPicker compact={isMobile} />

      {/* ── Dashboard search and filter (phone) ── */}
      {onPhoneDashboard && (
        <div className="flex shrink-0 items-center gap-[2px]">
          <button onClick={() => setSearchOpen(true)} aria-label={t('search')} className="p-[2px] rounded-full border border-border bg-card text-foreground hover:bg-muted">
            <Search className="h-3 w-3" />
          </button>
          <button onClick={() => setFilterOpen(true)} aria-label={t('dhFilters')} className="relative p-[2px] rounded-full border border-border bg-card text-foreground hover:bg-muted">
            <Filter className="h-3 w-3" />
            {dashFiltersActive && <span className="absolute -top-0.5 -end-0.5 h-2 w-2 rounded-full bg-primary" />}
          </button>
        </div>
      )}

      {/* ── Zoom Controls ── */}
      <ZoomControls className="shrink-0" compact={isMobile} />

      {/* ── New | Classic, for every page, chosen from the home page ── */}
      {onHome && <LayoutSwitch design={design} onChange={setDesign} className={cn('shrink-0', isMobile ? 'in-topbar ms-auto' : 'in-topbar-desk')} />}

      {/* ── Activity ── */}
      <div className="max-md:order-[-1] shrink-0">
        <ActivityCenter compact={isMobile} />
      </div>

      {/* ── Spacer ── */}
      <div className="flex-1 max-md:hidden" />

      {/* ── Sync indicator ── */}
      <div className="hidden md:flex items-center gap-1">
        <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-[11px] text-emerald-500 font-medium">{t('synced')}</span>
      </div>

      {/* ── User info ── */}
      {merchantProfile && (
        <button
          onClick={() => setProfileOpen(true)}
          className="hidden md:flex flex-col items-end cursor-pointer hover:opacity-80 transition-opacity"
        >
          <span className="text-[11px] font-semibold text-foreground leading-tight">{merchantProfile.display_name}</span>
          <span className="text-[9px] text-muted-foreground leading-tight">{t('clientId')}: {merchantProfile.merchant_code ?? merchantProfile.merchant_id.slice(0, 5)}</span>
        </button>
      )}

      {/* ── Sign out ── */}
      <button
        onClick={logout}
        className="hidden md:block px-2.5 py-1 rounded-md bg-muted hover:bg-muted/80 text-[11px] font-semibold text-muted-foreground transition-all"
      >
        {t('signOut')}
      </button>

      </div>

      <UserProfileModal open={profileOpen} onClose={() => setProfileOpen(false)} />
    </header>
  );
}
