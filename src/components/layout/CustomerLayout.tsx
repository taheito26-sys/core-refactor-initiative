import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Home, ShoppingCart, Wallet, MessageCircle, Menu, X, Settings, Store, Bell, TrendingUp, LogOut, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/features/auth/auth-context';
import { useTheme } from '@/lib/theme-context';
import { useIsMobile } from '@/hooks/use-mobile';
import '@/styles/tracker.css';

// PRD nav: Dashboard, Orders, Cash Management, Chat — 4 primary items
const PRIMARY_NAV = [
  { path: '/c/home',    icon: Home,          en: 'Home',   ar: 'الرئيسية' },
  { path: '/c/orders',  icon: ShoppingCart,  en: 'Orders', ar: 'الطلبات' },
  { path: '/c/wallet',  icon: Wallet,        en: 'Cash',   ar: 'النقد' },
  { path: '/c/chat',    icon: MessageCircle, en: 'Chat',   ar: 'المحادثات' },
] as const;

const DRAWER_NAV = [
  { path: '/c/market',        icon: TrendingUp, en: 'Market',        ar: 'السوق' },
  { path: '/c/merchants',     icon: Store,      en: 'Merchants',     ar: 'التجار' },
  { path: '/c/notifications', icon: Bell,       en: 'Notifications', ar: 'التنبيهات' },
  { path: '/c/settings',      icon: Settings,   en: 'Settings',      ar: 'الإعدادات' },
] as const;

export function CustomerLayout() {
  const location  = useLocation();
  const navigate  = useNavigate();
  const isMobile  = useIsMobile();
  const { logout, customerProfile } = useAuth();
  const { settings, update } = useTheme();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const isRTL = settings.language === 'ar';
  const lang  = isRTL ? 'ar' : 'en';
  const isChatRoute = location.pathname.startsWith('/c/chat');

  const isActive = (path: string) => location.pathname === path || location.pathname.startsWith(`${path}/`);
  const go = (path: string) => { navigate(path); setDrawerOpen(false); };

  const allNav = [...PRIMARY_NAV, ...DRAWER_NAV];

  const sidebar = (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r border-border/50 bg-background">
      <div className="flex items-center justify-between px-4 py-4">
        <span className="text-sm font-black uppercase tracking-widest">Tracker</span>
        {isMobile && <button onClick={() => setDrawerOpen(false)} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted"><X className="h-4 w-4" /></button>}
      </div>
      <div className="mx-3 mb-3 rounded-xl bg-muted/60 px-3 py-2.5">
        <p className="text-sm font-semibold truncate">{customerProfile?.display_name ?? '—'}</p>
        <p className="text-xs text-muted-foreground">{customerProfile?.country ?? ''}</p>
      </div>
      <nav className="flex-1 space-y-0.5 px-2">
        {allNav.map(item => (
          <button key={item.path} onClick={() => go(item.path)} className={cn('flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors', isActive(item.path) ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground')}>
            <item.icon className="h-4 w-4 shrink-0" />
            <span className="truncate">{item[lang]}</span>
          </button>
        ))}
      </nav>
      <div className="border-t border-border/50 p-3 space-y-1">
        <div className="flex items-center gap-1 rounded-lg bg-muted/60 p-0.5">
          {(['en', 'ar'] as const).map(l => (
            <button key={l} onClick={() => update({ language: l })} className={cn('flex-1 rounded-md py-1 text-[11px] font-semibold transition-colors', settings.language === l ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground')}>
              {l === 'en' ? 'EN' : 'AR'}
            </button>
          ))}
        </div>
        <button onClick={() => logout()} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors">
          <LogOut className="h-4 w-4" /><span>{isRTL ? 'تسجيل خروج' : 'Sign out'}</span>
        </button>
      </div>
    </aside>
  );

  return (
    <div className="tracker-root app-shell flex h-dvh overflow-hidden" dir={isRTL ? 'rtl' : 'ltr'}>
      {!isMobile && sidebar}
      {isMobile && drawerOpen && <div className="fixed inset-0 z-40 bg-black/50" onClick={() => setDrawerOpen(false)} />}
      {isMobile && drawerOpen && <div className={cn('fixed top-0 z-50 h-full', isRTL ? 'right-0' : 'left-0')}>{sidebar}</div>}

      <div className="main-shell flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Top bar */}
        <header className="sticky top-0 z-20 flex h-12 items-center gap-2 border-b border-border/50 bg-background/95 px-3 backdrop-blur">
          {isMobile && <button onClick={() => setDrawerOpen(true)} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted"><Menu className="h-4 w-4" /></button>}
          <span className="text-sm font-semibold truncate">{customerProfile?.display_name ?? 'Customer'}</span>
          <div className="flex-1" />
          {isMobile && (
            <div className="flex items-center gap-0.5 rounded-md bg-muted p-0.5">
              {(['en', 'ar'] as const).map(l => (
                <button key={l} onClick={() => update({ language: l })} className={cn('rounded px-2 py-0.5 text-[10px] font-bold transition-colors', settings.language === l ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')}>
                  {l.toUpperCase()}
                </button>
              ))}
            </div>
          )}
        </header>

        {/* Content */}
        <main className={cn('flex-1 min-h-0', isChatRoute ? 'overflow-hidden' : 'overflow-y-auto')}>
          {isChatRoute ? (
            <div className="flex h-full min-h-0 flex-col overflow-hidden"><Outlet /></div>
          ) : (
            <div className="mx-auto w-full max-w-2xl px-4 py-4"><Outlet /></div>
          )}
        </main>

        {/* Mobile bottom nav — 4 primary items + More */}
        {isMobile && (
          <nav className="flex h-14 items-stretch border-t border-border/50 bg-background/95 backdrop-blur">
            {PRIMARY_NAV.map(item => {
              const active = isActive(item.path);
              return (
                <button key={item.path} onClick={() => go(item.path)} className={cn('flex flex-1 flex-col items-center justify-center gap-0.5 text-[9px] font-semibold transition-colors', active ? 'text-primary' : 'text-muted-foreground')}>
                  <item.icon className="h-[18px] w-[18px]" />
                  <span>{item[lang]}</span>
                </button>
              );
            })}
            <button onClick={() => setDrawerOpen(true)} className="flex flex-1 flex-col items-center justify-center gap-0.5 text-[9px] font-semibold text-muted-foreground">
              <Menu className="h-[18px] w-[18px]" />
              <span>{isRTL ? 'المزيد' : 'More'}</span>
            </button>
          </nav>
        )}
      </div>
    </div>
  );
}
