import { useLocation } from 'react-router-dom';
import { useMemo } from 'react';
import { Menu } from 'lucide-react';
import ActivityCenter from '@/components/notifications/ActivityCenter';

function titleFromPath(pathname: string): { title: string; subtitle: string } {
  if (pathname === '/dashboard') return { title: 'Dashboard', subtitle: 'Trading overview' };
  if (pathname === '/trading/orders') return { title: 'Orders', subtitle: 'Manage trades' };
  if (pathname === '/trading/stock') return { title: 'Stock', subtitle: 'Inventory management' };
  if (pathname === '/trading/calendar') return { title: 'Calendar', subtitle: 'Schedule & events' };
  if (pathname === '/trading/p2p') return { title: 'P2P Tracker', subtitle: 'Live market rates' };
  if (pathname === '/crm') return { title: 'CRM', subtitle: 'Customer relationships' };
  if (pathname === '/network') return { title: 'Network', subtitle: 'Merchant connections' };
  if (pathname.startsWith('/network/')) return { title: 'Workspace', subtitle: 'Relationship details' };
  if (pathname === '/deals') return { title: 'Deals', subtitle: 'Deal management' };
  if (pathname === '/analytics') return { title: 'Analytics', subtitle: 'Performance insights' };
  if (pathname === '/vault') return { title: 'Vault', subtitle: 'Document storage' };
  if (pathname === '/settings') return { title: 'Settings', subtitle: 'Account preferences' };
  if (pathname === '/notifications') return { title: 'Notifications', subtitle: 'Activity feed' };
  return { title: 'P2P Tracker', subtitle: 'P2P Trading Platform' };
}

type TopBarProps = {
  isMobile?: boolean;
  onMenuClick?: () => void;
};

export function TopBar({ isMobile = false, onMenuClick }: TopBarProps) {
  const location = useLocation();
  const meta = useMemo(() => titleFromPath(location.pathname), [location.pathname]);

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border bg-background/95 backdrop-blur-sm px-4">
      {isMobile && onMenuClick && (
        <button
          onClick={onMenuClick}
          className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"
        >
          <Menu className="h-5 w-5" />
        </button>
      )}
      <div className="flex-1 min-w-0">
        <h1 className="text-sm font-bold text-foreground font-display leading-tight truncate">
          {meta.title}
        </h1>
        <p className="text-[11px] text-muted-foreground leading-tight truncate">
          {meta.subtitle}
        </p>
      </div>
      <ActivityCenter />
    </header>
  );
}
