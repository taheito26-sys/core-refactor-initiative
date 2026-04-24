import { useLocation, Link } from 'react-router-dom';
import {
  LayoutDashboard,
  TrendingUp,
  Wallet,
  Banknote,
  MessageCircle,
  Calendar,
  Settings,
  Bell,
  LogOut,
  ChevronLeft,
  UserCircle,
  X,
  MoreHorizontal,
  Store,
  ShieldCheck,
  Globe,
  Handshake,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/features/auth/auth-context';
import { useT } from '@/lib/i18n';
import { useState } from 'react';
import { useIsAdmin } from '@/features/admin/hooks/useAdminProfiles';

interface NavItem {
  labelKey: string;
  fallback: string;
  icon: LucideIcon;
  path: string;
}

export const tradingNav: NavItem[] = [
  { labelKey: 'dashboard', fallback: 'Dashboard', icon: LayoutDashboard, path: '/dashboard' },
  { labelKey: 'orders', fallback: 'Orders', icon: TrendingUp, path: '/trading/orders' },
  { labelKey: 'stock', fallback: 'Stock', icon: Wallet, path: '/trading/stock' },
  { labelKey: 'cashManagement', fallback: 'Cash', icon: Banknote, path: '/trading/cash' },
  { labelKey: 'crm', fallback: 'CRM', icon: UserCircle, path: '/crm' },
  { labelKey: 'chat', fallback: 'chat', icon: MessageCircle, path: '/chat' },
  { labelKey: 'calendar', fallback: 'Calendar', icon: Calendar, path: '/trading/calendar' },
  { labelKey: 'p2pTracker', fallback: 'P2P Market', icon: Globe, path: '/trading/p2p' },
];

export const networkNav: NavItem[] = [
  { labelKey: 'theMerchants', fallback: 'The Merchants', icon: Store, path: '/merchants' },
  { labelKey: 'marketplace', fallback: 'OTC Market', icon: Handshake, path: '/marketplace' },
  { labelKey: 'settings', fallback: 'Settings', icon: Settings, path: '/settings' },
];

type AppSidebarProps = {
  isMobile?: boolean;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
};

export function MobileBottomNav({ onMoreClick }: { onMoreClick: () => void }) {
  const location = useLocation();
  const t = useT();
  const primaryNav = [
    tradingNav[0], // Dashboard
    tradingNav[1], // Orders
    tradingNav[2], // Stock
    tradingNav[3], // Cash
    tradingNav[5], // Chat
  ].filter(Boolean) as NavItem[];

  return (
    <nav className="mobile-bottom-nav">
      {primaryNav.map((item) => {
        const [itemPath, itemQuery] = item.path.split('?');
        const active = itemQuery
          ? location.pathname === itemPath && location.search.includes(itemQuery)
          : location.pathname === item.path || location.pathname.startsWith(item.path + '/');
        return (
          <Link
            key={item.path}
            to={item.path}
            className={cn('mobile-bottom-nav__item', active && 'is-active')}
          >
            <span className="mobile-bottom-nav__icon-wrap">
              <item.icon className="mobile-bottom-nav__icon" />
            </span>
            <span className="mobile-bottom-nav__label">{t(item.labelKey as any) || item.fallback}</span>
          </Link>
        );
      })}
      <button onClick={onMoreClick} className="mobile-bottom-nav__item">
        <span className="mobile-bottom-nav__icon-wrap">
          <MoreHorizontal className="mobile-bottom-nav__icon" />
        </span>
        <span className="mobile-bottom-nav__label">More</span>
      </button>
    </nav>
  );
}

export function AppSidebar({ isMobile = false, mobileOpen = false, onMobileClose }: AppSidebarProps) {
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const { merchantProfile, logout } = useAuth();
  const { data: isAdmin } = useIsAdmin();
  const t = useT();

  const isActive = (path: string) =>
    location.pathname === path || location.pathname.startsWith(path + '/');

  const NavSection = ({ title, items }: { title: string; items: NavItem[] }) => (
    <div className="mb-2">
      {!collapsed && (
        <div className="px-4 py-1 text-[9px] font-black uppercase tracking-[0.2em] text-muted-foreground/40">
          {title}
        </div>
      )}
      <ul className="space-y-0.5 px-2">
        {items.map((item) => {
          const active = isActive(item.path);
          return (
            <li key={item.path}>
              <Link
                to={item.path}
                onClick={isMobile ? onMobileClose : undefined}
                className={cn(
                  'flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[12px] transition-all duration-200 group',
                  active
                    ? 'bg-primary/10 text-primary font-bold shadow-sm'
                    : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                )}
              >
                <item.icon className={cn(
                  'h-3.5 w-3.5 shrink-0 transition-colors',
                  active ? 'text-primary' : 'text-muted-foreground/40 group-hover:text-muted-foreground/70'
                )} />
                {!collapsed && <span className="truncate tracking-tight">{t(item.labelKey as any) || item.fallback}</span>}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );

  const sidebarContent = (
    <aside
      className={cn(
        'flex flex-col bg-background border-border h-full transition-all duration-300 ease-in-out overflow-hidden',
        'ltr:border-r rtl:border-l',
        collapsed ? 'w-[60px]' : 'w-[200px]'
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-4 shrink-0">
        {!collapsed && (
          <span className="font-black text-[14px] text-foreground tracking-tighter uppercase">
            Tracker
          </span>
        )}
        {!isMobile && (
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="p-1 rounded-lg hover:bg-muted text-muted-foreground/40 hover:text-foreground transition-colors"
          >
            <ChevronLeft className={cn('h-3.5 w-3.5 transition-transform duration-300', collapsed && 'ltr:rotate-180 rtl:rotate-0', !collapsed && 'rtl:rotate-180')} />
          </button>
        )}
        {isMobile && (
          <button onClick={onMobileClose} className="p-1 rounded-lg hover:bg-muted text-muted-foreground/40">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Merchant info */}
      {!collapsed && merchantProfile && (
        <div className="px-4 py-1 mb-3 shrink-0">
          <div className="text-[12px] font-black text-foreground truncate tracking-tight uppercase">
            {merchantProfile.display_name}
          </div>
          <div className="text-[10px] text-muted-foreground/50 font-bold truncate">
            @{merchantProfile.nickname}
          </div>
        </div>
      )}

      {/* Navigation */}
      <div className="flex-1 overflow-y-auto py-1 custom-scrollbar">
        <NavSection title={t('trading')} items={tradingNav} />
        <NavSection title={t('network')} items={networkNav} />
        
        {isAdmin && (
          <div className="mb-2">
            {!collapsed && (
              <div className="px-4 py-1 text-[9px] font-black uppercase tracking-[0.2em] text-muted-foreground/40">
                {t('admin')}
              </div>
            )}
            <ul className="space-y-0.5 px-2">
              <li>
                <Link
                  to="/admin"
                  onClick={isMobile ? onMobileClose : undefined}
                  className={cn(
                    'flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[12px] transition-all duration-200 group',
                    isActive('/admin')
                      ? 'bg-primary/10 text-primary font-bold shadow-sm'
                      : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                  )}
                >
                  <ShieldCheck className={cn(
                    'h-3.5 w-3.5 shrink-0 transition-colors',
                    isActive('/admin') ? 'text-primary' : 'text-muted-foreground/40 group-hover:text-muted-foreground/70'
                  )} />
                  {!collapsed && <span className="truncate tracking-tight">{t('admin') || 'Admin Center'}</span>}
                </Link>
              </li>
            </ul>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="mt-auto border-t border-border p-1.5 space-y-0.5 shrink-0">
        <Link
          to="/notifications"
          onClick={isMobile ? onMobileClose : undefined}
          className={cn(
            'flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[12px] transition-all duration-200 group',
            isActive('/notifications')
              ? 'bg-primary/10 text-primary font-bold'
              : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
          )}
        >
          <Bell className={cn(
            'h-3.5 w-3.5 shrink-0 transition-colors',
            isActive('/notifications') ? 'text-primary' : 'text-muted-foreground/40 group-hover:text-muted-foreground/70'
          )} />
          {!collapsed && <span className="tracking-tight">{t('notifications')}</span>}
        </Link>
        <button
          onClick={logout}
          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[12px] text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-all duration-200 group"
        >
          <LogOut className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40 group-hover:text-destructive transition-colors" />
          {!collapsed && <span className="tracking-tight">{t('signOut')}</span>}
        </button>
      </div>
    </aside>
  );

  if (!isMobile) {
    return sidebarContent;
  }

  // Mobile overlay
  return (
    <>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 bg-black/80 backdrop-blur-sm transition-opacity duration-300" onClick={onMobileClose} />
      )}
      <div
        className={cn(
          'fixed top-0 z-50 h-full transition-transform duration-300 ease-in-out',
          'ltr:left-0 rtl:right-0',
          mobileOpen ? 'translate-x-0' : 'ltr:-translate-x-full rtl:translate-x-full'
        )}
      >
        {sidebarContent}
      </div>
    </>
  );
}