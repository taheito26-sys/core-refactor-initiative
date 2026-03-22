import { Outlet } from 'react-router-dom';
import { useState } from 'react';
import { AppSidebar, MobileBottomNav } from './AppSidebar';
import { TopBar } from './TopBar';
import { useIsMobile } from '@/hooks/use-mobile';

export function AppLayout() {
  const isMobile = useIsMobile();
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  return (
    <div className="app-shell flex h-dvh overflow-hidden">
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
        <div className="app-content-scroll flex-1 overflow-y-auto">
          <div className="app-page-shell">
            <div className="app-page-content">
              <Outlet />
            </div>
          </div>
        </div>
        {isMobile && <MobileBottomNav onMoreClick={() => setMobileSidebarOpen(true)} />}
      </div>
    </div>
  );
}
