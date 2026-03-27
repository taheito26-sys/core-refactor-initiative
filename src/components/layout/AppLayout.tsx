import { Outlet, useLocation } from 'react-router-dom';
import { useState } from 'react';
import { AppSidebar, MobileBottomNav } from './AppSidebar';
import { TopBar } from './TopBar';
import { useIsMobile } from '@/hooks/use-mobile';
import { useTheme } from '@/lib/theme-context';
import { cn } from '@/lib/utils';
import { RequiredFieldsModal } from '@/features/auth/components/RequiredFieldsModal';

export function AppLayout() {
  const isMobile = useIsMobile();
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const { settings } = useTheme();
  const isRTL = settings.language === 'ar';

  const location = useLocation();
  const isChat = location.pathname.startsWith('/chat');

  return (
    <div
      className={cn('app-shell flex h-dvh overflow-hidden', `layout-${settings.layout}`)}
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
      <div className="main-shell flex flex-1 flex-col min-w-0">
        <TopBar
          isMobile={isMobile}
          onMenuClick={isMobile ? () => setMobileSidebarOpen(true) : undefined}
        />
        
        {isChat ? (
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
             <Outlet />
          </div>
        ) : (
          <div className="app-content-scroll flex-1 overflow-y-auto">
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
