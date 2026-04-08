import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Home, Store, ShoppingCart, MessageCircle, Settings, LogOut } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/features/auth/auth-context';
import { Button } from '@/components/ui/button';

const navItems = [
  { path: '/c/home', icon: Home, label: 'Home' },
  { path: '/c/merchants', icon: Store, label: 'Merchants' },
  { path: '/c/orders', icon: ShoppingCart, label: 'Orders' },
  { path: '/c/chat', icon: MessageCircle, label: 'Chat' },
  { path: '/c/settings', icon: Settings, label: 'Settings' },
];

export function CustomerLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { logout, customerProfile } = useAuth();

  return (
    <div className="flex h-dvh flex-col bg-background">
      {/* Top bar */}
      <header className="flex h-14 items-center justify-between border-b border-border px-4 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold text-primary">TRACKER</span>
          <span className="text-xs text-muted-foreground">Customer</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">{customerProfile?.display_name}</span>
          <Button variant="ghost" size="icon" onClick={() => logout()} title="Sign out">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl p-4">
          <Outlet />
        </div>
      </main>

      {/* Bottom nav */}
      <nav className="flex h-14 items-center justify-around border-t border-border bg-card shrink-0">
        {navItems.map((item) => {
          const active = location.pathname === item.path || location.pathname.startsWith(item.path + '/');
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={cn(
                'flex flex-col items-center gap-0.5 text-xs transition-colors',
                active ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <item.icon className="h-5 w-5" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
