import { useLocation } from 'react-router-dom';
import { useMemo, useState } from 'react';
import { Menu, Bell, Users, TrendingUp, User } from 'lucide-react';
import ActivityCenter from '@/components/notifications/ActivityCenter';
import { useTheme } from '@/lib/theme-context';
import { useT } from '@/lib/i18n';
import { useAuth } from '@/features/auth/auth-context';
import { cn } from '@/lib/utils';
import { UserProfileModal } from '@/features/profile/UserProfileModal';

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
  return { title: 'P2P Tracker', subtitle: 'P2P Trading Platform' };
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

  return (
    <header
      className="sticky top-0 z-20 flex items-center gap-1 md:gap-2 border-b border-border bg-background/95 backdrop-blur-sm px-2 md:px-3 py-1.5"
      style={isMobile ? {
        paddingTop: 'calc(env(safe-area-inset-top, 0px) + 6px)',
        paddingLeft: 'max(8px, env(safe-area-inset-left, 0px))',
        paddingRight: 'max(8px, env(safe-area-inset-right, 0px))',
      } : undefined}
    >
      {isMobile && onMenuClick && (
        <button onClick={onMenuClick} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground">
          <Menu className="h-4 w-4" />
        </button>
      )}

      {/* ── Period Toggle ── */}
      <div className="flex items-center gap-0.5 bg-muted rounded-md p-0.5">
        {RANGES.map(r => (
          <button
            key={r.id}
            onClick={() => update({ range: r.id as any })}
            className={cn(
              'px-1.5 py-1 rounded text-[10px] font-semibold transition-all md:px-2.5 md:text-[11px]',
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
      <div className="flex items-center gap-0.5 bg-muted rounded-md p-0.5">
        {(['QAR', 'USDT'] as const).map(c => (
          <button
            key={c}
            onClick={() => update({ currency: c })}
            className={cn(
              'px-1.5 py-1 rounded text-[10px] font-semibold transition-all md:px-2.5 md:text-[11px]',
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
      <div className="flex items-center gap-0.5 bg-muted rounded-md p-0.5">
        <button
          onClick={() => update({ language: 'ar' })}
          className={cn(
            'px-1.5 py-1 rounded text-[10px] font-semibold transition-all md:px-2.5 md:text-[11px]',
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
            'px-1.5 py-1 rounded text-[10px] font-semibold transition-all md:px-2.5 md:text-[11px]',
            settings.language === 'en'
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          <span className="md:hidden">EN</span>
          <span className="hidden md:inline">{t('english')}</span>
        </button>
      </div>

      {/* ── Activity ── */}
      <ActivityCenter />

      {/* ── Spacer ── */}
      <div className="flex-1" />

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

      <UserProfileModal open={profileOpen} onClose={() => setProfileOpen(false)} />
    </header>
  );
}
