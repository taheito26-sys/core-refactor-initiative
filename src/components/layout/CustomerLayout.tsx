import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, ShoppingCart, Store, Wallet, Bell, Settings, MessageCircle, LogOut, ChevronLeft, Menu, TrendingUp, type LucideIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/features/auth/auth-context';
import { useTheme } from '@/lib/theme-context';
import { useT } from '@/lib/i18n';
import { useIsMobile } from '@/hooks/use-mobile';
import '@/styles/tracker.css';

const navItems = [
  { path: '/c/home', icon: LayoutDashboard, labelKey: 'dashboard' },
  { path: '/c/market', icon: TrendingUp, labelKey: 'market' },
  { path: '/c/orders', icon: ShoppingCart, labelKey: 'orders' },
  { path: '/c/merchants', icon: Store, labelKey: 'merchants' },
  { path: '/c/wallet', icon: Wallet, labelKey: 'customerWallet' },
  { path: '/c/notifications', icon: Bell, labelKey: 'notifications' },
  { path: '/c/chat', icon: MessageCircle, labelKey: 'customerChat' },
  { path: '/c/settings', icon: Settings, labelKey: 'settings' },
] as const;

const mobilePrimaryNavPaths = new Set([
  '/c/home',
  '/c/market',
  '/c/orders',
  '/c/merchants',
  '/c/wallet',
  '/c/chat',
]);

function NavButton({
  path,
  label,
  Icon,
  active,
  onClick,
}: {
  path: string;
  label: string;
  Icon: LucideIcon;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
        active
          ? 'bg-primary/10 text-primary'
          : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground',
      )}
      aria-current={active ? 'page' : undefined}
      data-path={path}
    >
      <Icon className="h-4 w-4 shrink-0" />
            <span className="truncate">{label}</span>
          </button>
  );
}

function CustomerMobileBottomNav({
  items,
  isActive,
  navigate,
  onMoreClick,
  t,
}: {
  items: typeof navItems;
  isActive: (path: string) => boolean;
  navigate: (path: string) => void;
  onMoreClick: () => void;
  t: ReturnType<typeof useT>;
}) {
  const primaryItems = items.filter((item) => mobilePrimaryNavPaths.has(item.path));

  return (
    <nav className="flex h-16 items-stretch justify-around border-t border-border/60 bg-background/95 px-2 py-1 backdrop-blur">
      {primaryItems.map((item) => {
        const active = isActive(item.path);
        return (
          <button
            key={item.path}
            type="button"
            onClick={() => navigate(item.path)}
            className={cn(
              'flex flex-1 flex-col items-center justify-center gap-1 rounded-lg text-[10px] font-medium transition-colors',
              active ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
            )}
            aria-current={active ? 'page' : undefined}
          >
            <item.icon className="h-4 w-4" />
            <span className="truncate">{t(item.labelKey as never)}</span>
          </button>
        );
      })}

      <button
        type="button"
        onClick={onMoreClick}
        className="flex flex-1 flex-col items-center justify-center gap-1 rounded-lg text-[10px] font-medium text-muted-foreground transition-colors hover:text-foreground"
        aria-haspopup="menu"
      >
        <Menu className="h-4 w-4" />
        <span className="truncate">{t('menu')}</span>
      </button>
    </nav>
  );
}

export function CustomerLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { logout, customerProfile } = useAuth();
  const { settings, update } = useTheme();
  const t = useT();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const isRTL = settings.language === 'ar';

  const isActive = (path: string) =>
    location.pathname === path || location.pathname.startsWith(`${path}/`);

  useEffect(() => {
    if (!isMobile) {
      return;
    }

    setMobileMenuOpen(false);
  }, [isMobile, location.pathname]);

  const shell = (
    <aside className="flex h-full w-[268px] shrink-0 flex-col border-r border-border/60 bg-background/95 backdrop-blur">
      <div className="flex items-center justify-between px-4 py-4">
        <div>
          <div className="text-[11px] font-black uppercase tracking-[0.24em] text-muted-foreground/60">Tracker</div>
          <div className="text-lg font-black tracking-tight text-foreground">{t('customerDashboard')}</div>
        </div>
        {!isMobile && (
          <button
            type="button"
            onClick={() => setMobileMenuOpen(false)}
            className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label={t('close') || 'Close'}
          >
            <ChevronLeft className={cn('h-4 w-4', isRTL && 'rotate-180')} />
          </button>
        )}
      </div>

      <div className="px-4 pb-4">
        <div className="rounded-xl border border-border/60 bg-card px-4 py-3 shadow-sm">
          <div className="text-sm font-semibold text-foreground">{customerProfile?.display_name ?? t('customer')}</div>
          <div className="mt-1 text-xs text-muted-foreground">{customerProfile?.country ?? t('country')}</div>
        </div>
      </div>

      <nav className="flex-1 space-y-1 px-3">
        {navItems.map((item) => (
          <NavButton
            key={item.path}
            path={item.path}
            Icon={item.icon}
            label={item.path === '/c/market' ? (isRTL ? 'السوق' : 'Market') : t(item.labelKey as never)}
            active={isActive(item.path)}
            onClick={() => {
              navigate(item.path);
              setMobileMenuOpen(false);
            }}
          />
        ))}
      </nav>

      <div className="border-t border-border/60 p-4">
        <button
          type="button"
          onClick={() => logout()}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
        >
          <LogOut className="h-4 w-4" />
          <span>{t('signOut')}</span>
        </button>
      </div>
    </aside>
  );

  return (
    <div
      className={cn('tracker-root app-shell flex h-dvh overflow-hidden layout-operations_desk')}
      dir={isRTL ? 'rtl' : 'ltr'}
    >
      {!isMobile && shell}

      {isMobile && mobileMenuOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {isMobile && mobileMenuOpen && (
        <div className={cn('fixed top-0 z-50 h-full w-[280px] transition-transform', isRTL ? 'right-0' : 'left-0')}>
          {shell}
        </div>
      )}

      <div className="main-shell flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="sticky top-0 z-20 flex items-center gap-2 border-b border-border/60 bg-background/95 px-3 py-2.5 backdrop-blur">
          {isMobile && (
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label={t('menu') || 'Menu'}
            >
              <Menu className="h-4 w-4" />
            </button>
          )}

          <div className="flex min-w-0 flex-col">
            <div className="text-[10px] font-black uppercase tracking-[0.24em] text-muted-foreground/60">
              {t('customerPortal')}
            </div>
            <div className="truncate text-sm font-semibold text-foreground">
              {customerProfile?.display_name ?? t('customerDashboard')}
            </div>
          </div>

          <div className="flex-1" />

          <div className="flex items-center gap-1 rounded-md bg-muted p-0.5">
            <button
              type="button"
              onClick={() => update({ language: 'ar' })}
              className={cn(
                'rounded px-2.5 py-1 text-[11px] font-semibold transition-colors',
                settings.language === 'ar' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <span className="md:hidden">AR</span>
              <span className="hidden md:inline">{t('arabic')}</span>
            </button>
            <button
              type="button"
              onClick={() => update({ language: 'en' })}
              className={cn(
                'rounded px-2.5 py-1 text-[11px] font-semibold transition-colors',
                settings.language === 'en' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <span className="md:hidden">EN</span>
              <span className="hidden md:inline">{t('english')}</span>
            </button>
          </div>

          <button
            type="button"
            onClick={() => logout()}
            className="ml-1 hidden items-center gap-2 rounded-lg bg-muted px-3 py-2 text-[11px] font-semibold text-muted-foreground transition-colors hover:text-foreground md:flex"
          >
            <LogOut className="h-3.5 w-3.5" />
            {t('signOut')}
          </button>
        </header>

        <main className="flex-1 overflow-y-auto min-h-0">
          <div className="app-page-shell">
            <div className="app-page-content">
              <Outlet />
            </div>
          </div>
        </main>

        {isMobile && (
          <CustomerMobileBottomNav
            items={navItems}
            isActive={isActive}
            navigate={navigate}
            onMoreClick={() => setMobileMenuOpen(true)}
            t={t}
          />
        )}
      </div>
    </div>
  );
}
