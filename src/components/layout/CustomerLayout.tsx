import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Home, TrendingUp, ShoppingCart, Store, Wallet,
  Bell, MessageCircle, Settings, LogOut, Menu, X,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/features/auth/auth-context';
import { useTheme } from '@/lib/theme-context';
import { useT } from '@/lib/i18n';
import { useIsMobile } from '@/hooks/use-mobile';
import '@/styles/tracker.css';

const NAV = [
  { path: '/c/home',          icon: Home,          label: { en: 'Home',      ar: 'الرئيسية' } },
  { path: '/c/market',        icon: TrendingUp,    label: { en: 'Market',    ar: 'السوق' } },
  { path: '/c/orders',        icon: ShoppingCart,  label: { en: 'Orders',    ar: 'الطلبات' } },
  { path: '/c/merchants',     icon: Store,         label: { en: 'Merchants', ar: 'التجار' } },
  { path: '/c/wallet',        icon: Wallet,        label: { en: 'Wallet',    ar: 'المحفظة' } },
  { path: '/c/chat',          icon: MessageCircle, label: { en: 'Chat',      ar: 'المحادثات' } },
  { path: '/c/notifications', icon: Bell,          label: { en: 'Alerts',    ar: 'التنبيهات' } },
  { path: '/c/settings',      icon: Settings,      label: { en: 'Settings',  ar: 'الإعدادات' } },
] as const;

const BOTTOM_NAV = NAV.slice(0, 5); // Home, Market, Orders, Merchants, Wallet

export function CustomerLayout() {
  const location  = useLocation();
  const navigate  = useNavigate();
  const isMobile  = useIsMobile();
  const { logout, customerProfile } = useAuth();
  const { settings, update } = useTheme();
  const t = useT();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const isRTL = settings.language === 'ar';
  const lang  = isRTL ? 'ar' : 'en';
  const isChatRoute = location.pathname.startsWith('/c/chat');

  const isActive = (path: string) =>
    location.pathname === path || location.pathname.startsWith(`${path}/`);

  const go = (path: string) => { navigate(path); setDrawerOpen(false); };

  // ── Sidebar (desktop + drawer) ────────────────────────────────────────
  const sidebar = (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r border-border/50 bg-background">
      {/* Logo + close (drawer only) */}
      <div className="flex items-center justify-between px-4 py-4">
        <span className="text-sm font-black uppercase tracking-widest text-foreground">Tracker</span>
        {isMobile && (
          <button onClick={() => setDrawerOpen(false)} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Profile pill */}
      <div className="mx-3 mb-3 rounded-xl bg-muted/60 px-3 py-2.5">
        <p className="text-sm font-semibold text-foreground truncate">{customerProfile?.display_name ?? '—'}</p>
        <p className="text-xs text-muted-foreground">{customerProfile?.country ?? ''}</p>
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-0.5 px-2">
        {NAV.map(item => (
          <button
            key={item.path}
            onClick={() => go(item.path)}
            className={cn(
              'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              isActive(item.path)
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
            )}
          >
            <item.icon className="h-4 w-4 shrink-0" />
            <span className="truncate">{item.label[lang]}</span>
          </button>
        ))}
      </nav>

      {/* Footer */}
      <div className="border-t border-border/50 p-3 space-y-1">
        {/* Language toggle */}
        <div className="flex items-center gap-1 rounded-lg bg-muted/60 p-0.5">
          {(['en', 'ar'] as const).map(l => (
            <button
              key={l}
              onClick={() => update({ language: l })}
              className={cn(
                'flex-1 rounded-md py-1 text-[11px] font-semibold transition-colors',
                settings.language === l
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {l === 'en' ? 'EN' : 'AR'}
            </button>
          ))}
        </div>
        <button
          onClick={() => logout()}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
        >
          <LogOut className="h-4 w-4" />
          <span>{isRTL ? 'تسجيل خروج' : 'Sign out'}</span>
        </button>
      </div>
    </aside>
  );

  return (
    <div
      className="tracker-root app-shell flex h-dvh overflow-hidden"
      dir={isRTL ? 'rtl' : 'ltr'}
    >
      {/* Desktop sidebar */}
      {!isMobile && sidebar}

      {/* Mobile drawer backdrop */}
      {isMobile && drawerOpen && (
        <div className="fixed inset-0 z-40 bg-black/50" onClick={() => setDrawerOpen(false)} />
      )}

      {/* Mobile drawer */}
      {isMobile && drawerOpen && (
        <div className={cn('fixed top-0 z-50 h-full', isRTL ? 'right-0' : 'left-0')}>
          {sidebar}
        </div>
      )}

      {/* Main */}
      <div className="main-shell flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Top bar */}
        <header className="sticky top-0 z-20 flex h-12 items-center gap-2 border-b border-border/50 bg-background/95 px-3 backdrop-blur">
          {isMobile && (
            <button
              onClick={() => setDrawerOpen(true)}
              className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted"
            >
              <Menu className="h-4 w-4" />
            </button>
          )}
          <span className="text-sm font-semibold text-foreground truncate">
            {customerProfile?.display_name ?? 'Customer'}
          </span>
          <div className="flex-1" />
          {/* Language toggle (header, mobile) */}
          {isMobile && (
            <div className="flex items-center gap-0.5 rounded-md bg-muted p-0.5">
              {(['en', 'ar'] as const).map(l => (
                <button
                  key={l}
                  onClick={() => update({ language: l })}
                  className={cn(
                    'rounded px-2 py-0.5 text-[10px] font-bold transition-colors',
                    settings.language === l
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground',
                  )}
                >
                  {l.toUpperCase()}
                </button>
              ))}
            </div>
          )}
        </header>

        {/* Page content */}
        <main className={cn('flex-1 min-h-0', isChatRoute ? 'overflow-hidden' : 'overflow-y-auto')}>
          {isChatRoute ? (
            <div className="flex h-full min-h-0 flex-col overflow-hidden">
              <Outlet />
            </div>
          ) : (
            <div className="mx-auto w-full max-w-2xl px-4 py-4">
              <Outlet />
            </div>
          )}
        </main>

        {/* Mobile bottom nav */}
        {isMobile && (
          <nav className="flex h-14 items-stretch border-t border-border/50 bg-background/95 backdrop-blur">
            {BOTTOM_NAV.map(item => {
              const active = isActive(item.path);
              return (
                <button
                  key={item.path}
                  onClick={() => go(item.path)}
                  className={cn(
                    'flex flex-1 flex-col items-center justify-center gap-0.5 text-[9px] font-semibold transition-colors',
                    active ? 'text-primary' : 'text-muted-foreground',
                  )}
                >
                  <item.icon className="h-[18px] w-[18px]" />
                  <span>{item.label[lang]}</span>
                </button>
              );
            })}
            {/* More button */}
            <button
              onClick={() => setDrawerOpen(true)}
              className="flex flex-1 flex-col items-center justify-center gap-0.5 text-[9px] font-semibold text-muted-foreground"
            >
              <Menu className="h-[18px] w-[18px]" />
              <span>{isRTL ? 'المزيد' : 'More'}</span>
            </button>
          </nav>
        )}
      </div>
    </div>
  );
}
