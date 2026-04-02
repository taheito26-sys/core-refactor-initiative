import { useLocation, Link } from 'react-router-dom';
import {
  LayoutDashboard,
  ArrowLeftRight,
  Wallet,
  TrendingUp,
  MessageCircle,
  Briefcase,
  BarChart3,
  Settings,
  Bell,
  LogOut,
  ChevronLeft,
  Calendar,
  UserCircle,
  CloudUpload,
  X,
  MoreHorizontal,
  Store,
  ShieldCheck,
  Globe,
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
  { labelKey: 'crm', fallback: 'CRM', icon: UserCircle, path: '/crm' },
  { labelKey: 'chat', fallback: 'Chat', icon: MessageCircle, path: '/chat' },
  { labelKey: 'calendar', fallback: 'Calendar', icon: Calendar, path: '/trading/calendar' },
  { labelKey: 'p2pTracker', fallback: 'P2P Market', icon: Globe, path: '/trading/p2p' },
];

export const networkNav: NavItem[] = [
  { labelKey: 'theMerchants', fallback: 'The Merchants', icon: Store, path: '/merchants' },
  { labelKey: 'vault', fallback: 'Vault', icon: CloudUpload, path: '/trading/vault' },
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
    networkNav[0], // Merchants
    tradingNav[4], // Chat
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
function AdminNavSection({ collapsed, isActive, isMobile, onMobileClose }: { collapsed: boolean; isActive: (p: string) => boolean; isMobile: boolean; onMobileClose?: () => void }) {
  const { data: isAdmin } = useIsAdmin();
  const t = useT();
  if (!isAdmin) return null;
  return (
    <div className="mb-2">
      {!collapsed && (
        <div className="px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-sidebar-foreground/50">
          {t('admin') || 'Admin'}
        </div>
      )}
      <ul className="space-y-0.5 px-2">
        <li>
          <Link
            to="/admin"
            onClick={isMobile ? onMobileClose : undefined}
            className={cn(
              'flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] transition-colors',
              'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
              isActive('/admin') && 'bg-sidebar-accent text-sidebar-primary font-medium'
            )}
          >
            <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
            {!collapsed && <span>{t('admin') || 'Admin Center'}</span>}
          </Link>
        </li>
      </ul>
    </div>
  );
}

export function AppSidebar({ isMobile = false, mobileOpen = false, onMobileClose }: AppSidebarProps) {
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const { merchantProfile, logout } = useAuth();
  const t = useT();

  const isActive = (path: string) =>
    location.pathname === path || location.pathname.startsWith(path + '/');

  const NavSection = ({ title, items }: { title: string; items: NavItem[] }) => (
    <div className="mb-2">
      {!collapsed && (
        <div className="px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-sidebar-foreground/50">
          {title}
        </div>
      )}
      <ul className="space-y-0.5 px-2">
        {items.map((item) => (
          <li key={item.path}>
            <Link
              to={item.path}
              onClick={isMobile ? onMobileClose : undefined}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] transition-colors',
                'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                isActive(item.path) && 'bg-sidebar-accent text-sidebar-primary font-medium'
              )}
            >
              <item.icon className="h-3.5 w-3.5 shrink-0" />
              {!collapsed && <span className="truncate">{t(item.labelKey as any) || item.fallback}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );

  const sidebarContent = (
    <aside
      className={cn(
        'flex flex-col bg-sidebar border-sidebar-border h-full transition-all duration-200',
        'ltr:border-r rtl:border-l',
        collapsed ? 'w-[52px]' : 'w-fit min-w-[120px] max-w-[200px]'
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-4 border-b border-sidebar-border">
        {!collapsed && (
          <span className="font-display text-[13px] font-bold text-sidebar-foreground tracking-tight">
            P2P Tracker
          </span>
        )}
        {!isMobile && (
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="p-1 rounded hover:bg-sidebar-accent text-sidebar-foreground/60"
          >
            <ChevronLeft className={cn('h-3.5 w-3.5 transition-transform', collapsed && 'ltr:rotate-180 rtl:rotate-0', !collapsed && 'rtl:rotate-180')} />
          </button>
        )}
        {isMobile && (
          <button onClick={onMobileClose} className="p-1 rounded hover:bg-sidebar-accent text-sidebar-foreground/60">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Merchant info */}
      {!collapsed && merchantProfile && (
        <div className="px-3 py-3 border-b border-sidebar-border">
          <div className="text-[13px] font-medium text-sidebar-foreground truncate">
            {merchantProfile.display_name}
          </div>
          <div className="text-[11px] text-sidebar-foreground/50 truncate">
            @{merchantProfile.nickname}
          </div>
        </div>
      )}

      {/* Navigation */}
      <div className="flex-1 overflow-y-auto py-2">
        <NavSection title={t('trading')} items={tradingNav} />
        <NavSection title={t('network')} items={networkNav} />
        <AdminNavSection collapsed={collapsed} isActive={isActive} isMobile={isMobile} onMobileClose={onMobileClose} />
      </div>

      {/* Footer */}
      <div className="border-t border-sidebar-border p-2 space-y-0.5">
        <Link
          to="/notifications"
          onClick={isMobile ? onMobileClose : undefined}
          className={cn(
            'flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] transition-colors',
            'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
            isActive('/notifications') && 'bg-sidebar-accent text-sidebar-primary font-medium'
          )}
        >
          <Bell className="h-3.5 w-3.5 shrink-0" />
          {!collapsed && <span>{t('notifications')}</span>}
        </Link>
        <button
          onClick={logout}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[13px] text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-destructive transition-colors"
        >
          <LogOut className="h-3.5 w-3.5 shrink-0" />
          {!collapsed && <span>{t('signOut')}</span>}
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
        <div className="fixed inset-0 z-40 bg-black/50" onClick={onMobileClose} />
      )}
      <div
        className={cn(
          'fixed top-0 z-50 h-full transition-transform duration-200',
          'ltr:left-0 rtl:right-0',
          mobileOpen ? 'translate-x-0' : 'ltr:-translate-x-full rtl:translate-x-full'
        )}
      >
        {sidebarContent}
      </div>
    </>
  );
}
