import { useLocation } from 'react-router-dom';
import { useMemo } from 'react';
import { Menu, Globe } from 'lucide-react';
import ActivityCenter from '@/components/notifications/ActivityCenter';
import { useTheme } from '@/lib/theme-context';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';

function titleFromPath(pathname: string, t: ReturnType<typeof useT>): { title: string; subtitle: string } {
  if (pathname === '/dashboard') return { title: t('dashboard'), subtitle: t('dashboardSub') };
  if (pathname === '/trading/orders') return { title: t('orders'), subtitle: t('tradesSub') };
  if (pathname === '/trading/stock') return { title: t('stock'), subtitle: t('stockSub') };
  if (pathname === '/trading/calendar') return { title: t('calendar'), subtitle: t('calendarSub') };
  if (pathname === '/trading/p2p') return { title: t('p2pTracker'), subtitle: 'Live market rates' };
  if (pathname === '/crm') return { title: t('crm'), subtitle: t('crmSub') };
  if (pathname === '/network') return { title: t('network'), subtitle: 'Merchant connections' };
  if (pathname.startsWith('/network/')) return { title: 'Workspace', subtitle: 'Relationship details' };
  if (pathname === '/deals') return { title: t('deals'), subtitle: 'Deal management' };
  if (pathname === '/analytics') return { title: t('analytics'), subtitle: 'Performance insights' };
  if (pathname === '/vault') return { title: t('vault'), subtitle: 'Document storage' };
  if (pathname === '/settings') return { title: t('settings'), subtitle: t('layoutThemesData') };
  if (pathname === '/notifications') return { title: t('notifications'), subtitle: 'Activity feed' };
  return { title: 'P2P Tracker', subtitle: 'P2P Trading Platform' };
}

const RANGES = [
  { id: 'today', label: '1D' },
  { id: '7d', label: '7D' },
  { id: '30d', label: '30D' },
  { id: 'all', label: 'All' },
] as const;

type TopBarProps = {
  isMobile?: boolean;
  onMenuClick?: () => void;
};

export function TopBar({ isMobile = false, onMenuClick }: TopBarProps) {
  const location = useLocation();
  const { settings, update } = useTheme();
  const t = useT();
  const meta = useMemo(() => titleFromPath(location.pathname, t), [location.pathname, t]);

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

      {/* ── Period Toggle ── */}
      <div className="hidden md:flex items-center gap-0.5 bg-muted rounded-md p-0.5">
        {RANGES.map(r => (
          <button
            key={r.id}
            onClick={() => update({ range: r.id as any })}
            className={cn(
              'px-2 py-0.5 rounded text-[10px] font-semibold transition-all',
              settings.range === r.id
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {r.label}
          </button>
        ))}
      </div>

      {/* ── Currency Toggle ── */}
      <div className="hidden md:flex items-center gap-0.5 bg-muted rounded-md p-0.5">
        {(['QAR', 'USDT'] as const).map(c => (
          <button
            key={c}
            onClick={() => update({ currency: c })}
            className={cn(
              'px-2 py-0.5 rounded text-[10px] font-semibold transition-all',
              settings.currency === c
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {c}
          </button>
        ))}
      </div>

      {/* ── Language Toggle ── */}
      <button
        onClick={() => update({ language: settings.language === 'en' ? 'ar' : 'en' })}
        className="flex items-center gap-1 px-2 py-1 rounded-md bg-muted hover:bg-muted/80 text-[10px] font-semibold text-muted-foreground transition-all"
        title={settings.language === 'en' ? 'Switch to Arabic' : 'Switch to English'}
      >
        <Globe className="w-3 h-3" />
        {settings.language === 'en' ? 'AR' : 'EN'}
      </button>

      <ActivityCenter />
    </header>
  );
}
