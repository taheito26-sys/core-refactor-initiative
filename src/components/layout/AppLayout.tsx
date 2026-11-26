import { Outlet, useLocation } from 'react-router-dom';
import { useLayoutEffect, useState } from 'react';
import { AppSidebar, MobileBottomNav } from './AppSidebar';
import { TopBar } from './TopBar';
import { useIsMobile } from '@/hooks/use-mobile';
import { useTheme } from '@/lib/theme-context';
import { cn } from '@/lib/utils';
import { RequiredFieldsModal } from '@/features/auth/components/RequiredFieldsModal';
import { useAuth } from '@/features/auth/auth-context';
import { usePushRegistration } from '@/hooks/usePushRegistration';
import { useWebPushRegistration } from '@/hooks/useWebPush';
import { useNotificationPresence } from '@/hooks/useNotificationPresence';
import { useReadReceiptSync } from '@/hooks/useReadReceiptSync';
import { useAutoVaultBackup } from '@/hooks/useAutoVaultBackup';
import '@/styles/taheito-merchant.css';

export function AppLayout() {
  const location = useLocation();
  const isLoans = location.pathname === '/trading/orders' && new URLSearchParams(location.search).get('tab') === 'usdt';
  const isMobile = useIsMobile(isLoans ? 1100 : 768);
  // This page sizes itself to the viewport. Do not compound the saved app zoom
  // with a second page scale, which previously left a miniature canvas on phones.
  useLayoutEffect(() => {
    if (!isLoans) return;
    const root = document.documentElement;
    const previousZoom = root.style.zoom;
    const previousAppZoom = root.style.getPropertyValue('--app-zoom');
    root.style.zoom = '1';
    root.style.setProperty('--app-zoom', '1');
    return () => {
      root.style.zoom = previousZoom;
      if (previousAppZoom) root.style.setProperty('--app-zoom', previousAppZoom);
      else root.style.removeProperty('--app-zoom');
    };
  }, [isLoans]);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const { settings } = useTheme();
  const isRTL = settings.language === 'ar';

  // App-level hooks: push registration + cross-device read sync
  usePushRegistration();
  useWebPushRegistration();
  useNotificationPresence();
  useReadReceiptSync();
  useAutoVaultBackup();

  const isChat = location.pathname.startsWith('/chat');

  return (
    <div
      className={cn('app-shell flex h-dvh overflow-hidden', `layout-${settings.layout}`, location.pathname === '/trading/p2p' && 'pm-shell', isLoans && 'loans-reference-shell')}
      dir={isRTL ? 'rtl' : 'ltr'}
    >
      {/* Desktop sidebar */}
      {!isMobile && <AppSidebar />}

      {/* Mobile sidebar overlay */}
      {isMobile && (
        <AppSidebar
          isMobile
          mobileOpen={mobileSidebarOpen}
          onMobileClose={() => setMobileSidebarOpen(false)}
        />
      )}

      {/* Main content area */}
      <div className="main-shell flex flex-1 flex-col min-w-0 min-h-0">
        <TopBar
          isMobile={isMobile}
          loansReference={isLoans}
          onMenuClick={isMobile ? () => setMobileSidebarOpen(true) : undefined}
        />
        
        {isChat ? (
          <div className={cn('flex-1 flex flex-col min-h-0 overflow-hidden', isMobile && 'mobile-nav-clear')}>
             <Outlet />
          </div>
        ) : (
          <div className="app-content-scroll flex-1 min-h-0 overflow-y-auto">
            <div className="app-page-shell">
              <div className="app-page-content">
                <Outlet />
              </div>
            </div>
          </div>
        )}
        
        {isMobile && <MobileBottomNav onMoreClick={() => setMobileSidebarOpen(true)} />}
      </div>

      {/* Blocks the app if display_name or merchant_id are missing */}
      <RequiredFieldsModal />
    </div>
  );
}
