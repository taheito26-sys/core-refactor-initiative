import { useLocation, Link } from 'react-router-dom';
import {
  LayoutDashboard,
  ArrowLeftRight,
  Wallet,
  TrendingUp,
  Users,
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
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/features/auth/auth-context';
import { useState } from 'react';

interface NavItem {
  label: string;
  icon: LucideIcon;
  path: string;
}

export const tradingNav: NavItem[] = [
  { label: 'Dashboard', icon: LayoutDashboard, path: '/dashboard' },
  { label: 'Orders', icon: ArrowLeftRight, path: '/trading/orders' },
  { label: 'Stock', icon: Wallet, path: '/trading/stock' },
  { label: 'Calendar', icon: Calendar, path: '/trading/calendar' },
  { label: 'P2P Tracker', icon: TrendingUp, path: '/trading/p2p' },
  { label: 'CRM', icon: UserCircle, path: '/crm' },
];

export const networkNav: NavItem[] = [
  { label: 'Network', icon: Users, path: '/network' },
  { label: 'Deals', icon: Briefcase, path: '/deals' },
  { label: 'Analytics', icon: BarChart3, path: '/analytics' },
  { label: 'Vault', icon: CloudUpload, path: '/trading/vault' },
  { label: 'Settings', icon: Settings, path: '/settings' },
];

type AppSidebarProps = {
  isMobile?: boolean;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
};

export function MobileBottomNav({ onMoreClick }: { onMoreClick: () => void }) {
  const location = useLocation();
  const primaryNav = [
    tradingNav[0], // Dashboard
    tradingNav[1], // Orders
    tradingNav[2], // Stock
    tradingNav[4], // P2P Tracker
    networkNav[0], // Network
    tradingNav[3], // Calendar
    networkNav[3], // Vault
  ];

  return (
    <nav className="mobile-bottom-nav">
      {primaryNav.map((item) => {
        const active = location.pathname === item.path || location.pathname.startsWith(item.path + '/');
        return (
          <Link
            key={item.path}
            to={item.path}
            className={cn('mobile-bottom-nav__item', active && 'is-active')}
          >
            <span className="mobile-bottom-nav__icon-wrap">
              <item.icon className="mobile-bottom-nav__icon" />
            </span>
            <span className="mobile-bottom-nav__label">{item.label}</span>
          </Link>
        );
      })}
      <button
        onClick={onMoreClick}
        className="mobile-bottom-nav__item"
      >
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

  const isActive = (path: string) =>
    location.pathname === path || location.pathname.startsWith(path + '/');

  const NavSection = ({ title, items }: { title: string; items: NavItem[] }) => (
    <div className="mb-2">
      {!collapsed && (
        <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-sidebar-foreground/50">
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
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                isActive(item.path) && 'bg-sidebar-accent text-sidebar-primary font-medium'
              )}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {!collapsed && <span className="truncate">{item.label}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );

  const sidebarContent = (
    <aside
      className={cn(
        'flex flex-col bg-sidebar border-r border-sidebar-border h-full transition-all duration-200',
        collapsed ? 'w-[60px]' : 'w-[220px]'
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-4 border-b border-sidebar-border">
        {!collapsed && (
          <span className="font-display text-sm font-bold text-sidebar-foreground tracking-tight">
            P2P Tracker
          </span>
        )}
        {!isMobile && (
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="p-1 rounded hover:bg-sidebar-accent text-sidebar-foreground/60"
          >
            <ChevronLeft className={cn('h-4 w-4 transition-transform', collapsed && 'rotate-180')} />
          </button>
        )}
        {isMobile && (
          <button onClick={onMobileClose} className="p-1 rounded hover:bg-sidebar-accent text-sidebar-foreground/60">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Merchant info */}
      {!collapsed && merchantProfile && (
        <div className="px-3 py-3 border-b border-sidebar-border">
          <div className="text-xs font-medium text-sidebar-foreground truncate">
            {merchantProfile.display_name}
          </div>
          <div className="text-[10px] text-sidebar-foreground/50 truncate">
            @{merchantProfile.nickname}
          </div>
        </div>
      )}

      {/* Navigation */}
      <div className="flex-1 overflow-y-auto py-2">
        <NavSection title="Trading" items={tradingNav} />
        <NavSection title="Network" items={networkNav} />
      </div>

      {/* Footer */}
      <div className="border-t border-sidebar-border p-2 space-y-0.5">
        <Link
          to="/notifications"
          onClick={isMobile ? onMobileClose : undefined}
          className={cn(
            'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
            'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
            isActive('/notifications') && 'bg-sidebar-accent text-sidebar-primary font-medium'
          )}
        >
          <Bell className="h-4 w-4 shrink-0" />
          {!collapsed && <span>Notifications</span>}
        </Link>
        <button
          onClick={logout}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-destructive transition-colors"
        >
          <LogOut className="h-4 w-4 shrink-0" />
          {!collapsed && <span>Sign Out</span>}
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
          'fixed left-0 top-0 z-50 h-full transition-transform duration-200',
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        {sidebarContent}
      </div>
    </>
  );
}
