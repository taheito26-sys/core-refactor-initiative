import React, { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/features/auth/auth-context";
import { AuthGuard } from "@/features/auth/guards/AuthGuard";
import { ProfileGuard } from "@/features/auth/guards/ProfileGuard";
import { CustomerGuard } from "@/features/auth/guards/CustomerGuard";
import { ThemeProvider } from "@/lib/theme-context";
import { AppLayout } from "@/components/layout/AppLayout";
import { createPlaceholderPage } from "@/components/shared/PlaceholderPage";
import { AuthDiagnostics } from "@/features/auth/components/AuthDiagnostics";
import { NativePlatformBootstrap } from "@/platform/native-bridge";
import { ChatRuntimeBootstrap } from "@/features/chat/components/ChatRuntimeBootstrap";
import { ExchangeAutoSyncBootstrap } from "@/features/exchanges/components/ExchangeAutoSyncBootstrap";
import MobileInstallPrompt from "@/components/shared/MobileInstallPrompt";
import { OfflineStatusBanner } from "@/components/shared/OfflineStatusBanner";
import { isInstalledPwa, isNativeApp } from "@/platform/runtime";
import { Loader2 } from "lucide-react";

function PwaDebugBadge() {
  const enabled =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('pwa_debug') === '1';

  const [installPromptSeen, setInstallPromptSeen] = useState(false);
  const [swInfo, setSwInfo] = useState<{
    supported: boolean;
    controller: boolean;
    registrations: number | null;
  }>({ supported: typeof navigator !== 'undefined' && 'serviceWorker' in navigator, controller: false, registrations: null });
  const [manifestHref, setManifestHref] = useState<string | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      // Don't allow the browser to auto-show mini-infobar; we want control.
      e.preventDefault();
      setInstallPromptSeen(true);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  useEffect(() => {
    // Read manifest link (if present)
    try {
      const href = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')?.href ?? null;
      setManifestHref(href);
    } catch {
      setManifestHref(null);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    const refreshSwInfo = async () => {
      if (!('serviceWorker' in navigator)) {
        if (!cancelled) setSwInfo({ supported: false, controller: false, registrations: null });
        return;
      }

      try {
        const regs = await navigator.serviceWorker.getRegistrations();
        if (cancelled) return;
        setSwInfo({
          supported: true,
          controller: Boolean(navigator.serviceWorker.controller),
          registrations: regs.length,
        });
      } catch {
        if (!cancelled) {
          setSwInfo({ supported: true, controller: Boolean(navigator.serviceWorker.controller), registrations: null });
        }
      }
    };

    void refreshSwInfo();
    const t = window.setInterval(() => void refreshSwInfo(), 2000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, []);

  const safeGet = (key: string) => {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  };

  const INSTALLED_KEY = 'pwa-install-prompt-installed';
  const POSTPONE_UNTIL_KEY = 'pwa-install-prompt-postpone-until';

  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const mobileUA = /iphone|ipad|ipod|android|mobile/i.test(ua);
  const narrow = window.matchMedia?.('(max-width: 1024px)').matches ?? false;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const mobileSurface = mobileUA || narrow || coarse;

  const installedFlag = Boolean(safeGet(INSTALLED_KEY));
  const postponeUntilRaw = safeGet(POSTPONE_UNTIL_KEY);
  const postponeUntil = postponeUntilRaw ? Number(postponeUntilRaw) : 0;
  const isPostponed = Number.isFinite(postponeUntil) && Date.now() < postponeUntil;
  const shouldBlock =
    mobileSurface &&
    !isNativeApp() &&
    !isInstalledPwa() &&
    !installedFlag &&
    !isPostponed;

  if (!enabled) return null;

  return (
    <div className="fixed bottom-2 left-2 z-[200] rounded-lg border border-border bg-background/90 px-2 py-1 text-[11px] text-muted-foreground shadow-sm backdrop-blur">
      <div className="font-mono">
        <div>pwa_debug=1 active</div>
        <div>build: {String(__APP_BUILD_ID__)}</div>
        <div>mobileSurface: {String(mobileSurface)}</div>
        <div>isNativeApp: {String(isNativeApp())}</div>
        <div>isInstalledPwa: {String(isInstalledPwa())}</div>
        <div>installedFlag(ls): {String(installedFlag)}</div>
        <div>postponeUntil(ls): {String(postponeUntilRaw)}</div>
        <div>isPostponed: {String(isPostponed)}</div>
        <div>shouldBlock(calc): {String(shouldBlock)}</div>
        <div>beforeinstallprompt(seen): {String(installPromptSeen)}</div>
        <div>manifest: {manifestHref ? 'yes' : 'no'}</div>
        <div>sw.supported: {String(swInfo.supported)}</div>
        <div>sw.controller: {String(swInfo.controller)}</div>
        <div>sw.registrations: {String(swInfo.registrations)}</div>
      </div>
    </div>
  );
}

// Auth pages
import OAuthCallbackPage from "./pages/auth/OAuthCallbackPage";
import LoginPage from "./pages/auth/LoginPage";
import SignupPage from "./pages/auth/SignupPage";
import VerifyEmailPage from "./pages/auth/VerifyEmailPage";
import ResetPasswordPage from "./pages/auth/ResetPasswordPage";
import PendingApprovalPage from "./pages/auth/PendingApprovalPage";
import AccountRejectedPage from "./pages/auth/AccountRejectedPage";

// CustomerLayout is the one customer-portal import kept eager — it's the
// small shell (~150 lines) every /c/* route renders into, so a customer
// needs it immediately on first navigation into the portal regardless of
// which page they land on.
import { CustomerLayout } from "@/components/layout/CustomerLayout";

// The customer pages themselves used to be eager too, on the reasoning that
// "a customer needs one of these on first paint regardless" — true once
// they're inside /c/*, but not for /login itself: that page is the very
// first thing EVERY visitor sees, merchant or customer, before anyone knows
// which portal they belong to, and it was paying for all ~5,200 lines of
// customer-only page code (CustomerOrdersPage + CustomerWalletPage alone
// are ~3,700 lines) on every single load. Lazy-loading these the same way
// the merchant routes were split shrinks what /login (and /signup, etc.)
// has to download before it's interactive.
const CustomerOnboardingPage = React.lazy(() => import("./pages/customer/CustomerOnboardingPage"));
const CustomerHomePage = React.lazy(() => import("./pages/customer/CustomerHomePage"));
const CustomerMerchantsPage = React.lazy(() => import("./pages/customer/CustomerMerchantsPage"));
const CustomerOrdersPage = React.lazy(() => import("./pages/customer/CustomerOrdersPage"));
const CustomerNotificationsPage = React.lazy(() => import("./pages/customer/CustomerNotificationsPage"));
const CustomerChatPage = React.lazy(() => import("./pages/customer/CustomerChatPage"));
const CustomerSettingsPage = React.lazy(() => import("./pages/customer/CustomerSettingsPage"));
const CustomerWalletPage = React.lazy(() => import("./pages/customer/CustomerWalletPage"));

// Merchant onboarding, admin, and the merchant app shell's pages were all
// imported eagerly at module scope, so a customer who never visits any of
// them still downloaded and parsed all of it on sign-in — OrdersPage.tsx
// alone is ~6,200 lines. React.lazy defers the import until the route is
// actually navigated to, and the single Suspense boundary around <Routes>
// below only engages for these; the customer/auth pages above never
// suspend, so their first paint is unaffected.
const OnboardingPage = React.lazy(() => import("./pages/merchant/OnboardingPage"));
const AdminApprovalsPage = React.lazy(() => import("./pages/admin/AdminApprovalsPage"));
const AdminPage = React.lazy(() => import("./pages/admin/AdminPage"));
const DashboardPage = React.lazy(() => import('./pages/DashboardPage'));
const OrdersPage = React.lazy(() => import('./pages/OrdersPage'));
const OrdersImportLedgerPage = React.lazy(() => import('./pages/OrdersImportLedgerPage'));
const StockPage = React.lazy(() => import('./pages/StockPage'));
const CashPage = React.lazy(() => import('./pages/CashPage'));
const P2PTrackerPage = React.lazy(() => import('./pages/P2PTrackerPage'));
const SettingsPage = React.lazy(() => import('./pages/SettingsPage'));
const CalendarPage = React.lazy(() => import('./pages/CalendarPage'));
const MerchantsPage = React.lazy(() => import('./pages/MerchantsPage'));
const RelationshipPage = React.lazy(() => import('./pages/RelationshipPage'));
const ChatPage = React.lazy(() => import('./pages/ChatPage'));
const ChatPreview = React.lazy(() => import('./pages/ChatPreview'));
const MarketplacePage = React.lazy(() => import('./features/marketplace/pages/MarketplacePage'));
const PublicBuyerStatementPage = React.lazy(() => import('./pages/public/PublicBuyerStatementPage'));
const NotificationsPage = React.lazy(() => import('./pages/NotificationsPage'));

const MessagesPage = createPlaceholderPage('Messages', 'Direct messages');
const InvitationsPage = createPlaceholderPage('Invitations', 'Manage invitations');
const ApprovalsPage = createPlaceholderPage('Approvals', 'Pending approvals');
const RelationshipsPage = createPlaceholderPage('Relationships', 'Manage relationships');
const RelationshipWorkspace = createPlaceholderPage('Workspace', 'Relationship workspace');

import NotFound from "./pages/NotFound";

function RouteLoadingFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
}

// Default staleTime: 0 (TanStack Query's own default) meant every mount or
// window refocus refetched every query from scratch, even ones a realtime
// channel keeps fresh already (e.g. customer_orders) — a customer bouncing
// Home -> Orders -> Wallet -> Home re-fetched the same cash accounts,
// connections, etc. on every hop. 30s gives navigation-speed caching while
// staying well under any staleness a merchant/customer would notice; tables
// with a realtime subscription invalidate their queries immediately on a
// real change regardless of this window, so it doesn't mask live updates.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
    },
  },
});

// ── Register the PWA service worker unconditionally ──
// This used to run only inside PwaDebugBadge, which bails out before its
// hooks run unless `?pwa_debug=1` is in the URL — so the service worker
// never registered for real users, no installable app criteria were ever
// met, and "Add to Home Screen" on iOS/Android fell back to a plain
// browser-chrome shortcut instead of a real standalone install.
(async function registerPwaServiceWorker() {
  try {
    if (!('serviceWorker' in navigator)) return;
    const mod = await import('virtual:pwa-register');
    const registerSW: undefined | ((opts?: unknown) => void) = (mod as { registerSW?: (opts?: unknown) => void }).registerSW;
    if (typeof registerSW === 'function') {
      registerSW({ immediate: true });
    }
  } catch {
    // vite-plugin-pwa virtual module is unavailable when DISABLE_PWA_BUILD=1
  }
})();

// ── Aggressive SW cleanup on every app boot ──
// This ensures stale service workers never block new deployments
(async function cleanupStaleSW() {
  try {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (const reg of registrations) {
        // Force the waiting SW to activate immediately
        if (reg.waiting) {
          reg.waiting.postMessage({ type: 'SKIP_WAITING' });
        }
        // Check for updates
        reg.update().catch(() => {});
      }
    }
  } catch {
    // Best effort
  }
})();

class RouteErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; autoCleared: boolean }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, autoCleared: false };
  }

  componentDidMount() {
    this.clearRecoveryQueryParam();
  }

  componentDidUpdate() {
    if (!this.state.hasError) {
      this.clearRecoveryQueryParam();
    }
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.error('[RouteErrorBoundary] route render failed', error);
    // Auto-clear caches at most once per cooldown window (prevents reload loops).
    const key = '_p2p_auto_clear_attempt_ts';
    const lastAttempt = Number(sessionStorage.getItem(key) || '0');
    const now = Date.now();
    const cooldownMs = 5 * 60 * 1000;
    if (now - lastAttempt > cooldownMs) {
      sessionStorage.setItem(key, String(now));
      this.clearAndReload();
    }
  }

  clearAndReload = async (targetHref?: string) => {
    try {
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map(r => r.unregister()));
      }
      if ('caches' in window) {
        const names = await caches.keys();
        await Promise.all(names.map(n => caches.delete(n)));
      }
    } catch {
      // Best effort
    }
    if (targetHref) {
      window.location.replace(targetHref);
      return;
    }
    window.location.reload();
  };

  handleClearAndReload = async () => {
    sessionStorage.removeItem('_p2p_auto_clear_attempt_ts');
    await this.clearAndReload();
  };

  clearRecoveryQueryParam = () => {
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.get('_cache_cleared') !== '1') return;
      url.searchParams.delete('_cache_cleared');
      window.history.replaceState({}, '', url.toString());
    } catch {
      // Best effort
    }
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-background p-8">
          <div className="text-center space-y-4">
            <h2 className="text-xl font-semibold text-foreground">This page could not be rendered.</h2>
            <p className="text-muted-foreground">
              This is usually caused by a stale cache. Tap below to clear and reload.
            </p>
            <button
              onClick={this.handleClearAndReload}
              className="mt-4 px-6 py-3 rounded-xl bg-primary text-primary-foreground font-semibold text-sm shadow-sm hover:opacity-90 transition-opacity"
            >
              Clear Cache & Reload
            </button>
            <p className="text-xs text-muted-foreground mt-2">
              If this keeps happening, clear your browser data for this site.
            </p>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner richColors position="bottom-right" />
         <BrowserRouter>
          <NativePlatformBootstrap />
          <OfflineStatusBanner />
          <AuthProvider>
            <PwaDebugBadge />
            <MobileInstallPrompt />
            <AuthDiagnostics />
            <ChatRuntimeBootstrap />
            <ExchangeAutoSyncBootstrap />
            <RouteErrorBoundary>
              <React.Suspense fallback={<RouteLoadingFallback />}>
              <Routes>
                {/* OAuth callback — Supabase redirects here after Google consent */}
                <Route path="/auth/callback" element={<OAuthCallbackPage />} />

                {/* Auth — public */}
                <Route path="/login" element={<LoginPage />} />
                <Route path="/signup" element={<SignupPage />} />
                <Route path="/verify-email" element={<VerifyEmailPage />} />
                <Route path="/reset-password" element={<ResetPasswordPage />} />
                <Route path="/chat-preview" element={<ChatPreview />} />
                <Route path="/statements/:token" element={<PublicBuyerStatementPage />} />

                {/* Pending approval — requires auth but not profile */}
                <Route path="/pending-approval" element={
                  <AuthGuard><PendingApprovalPage /></AuthGuard>
                } />
                <Route path="/account-rejected" element={
                  <AuthGuard><AccountRejectedPage /></AuthGuard>
                } />

                {/* Onboarding — requires auth */}
                <Route path="/onboarding" element={
                  <AuthGuard><OnboardingPage /></AuthGuard>
                } />

                {/* Customer onboarding — requires auth */}
                <Route path="/c/onboarding" element={
                  <AuthGuard><CustomerOnboardingPage /></AuthGuard>
                } />

                {/* Customer Portal — requires auth + customer profile */}
                <Route element={
                  <AuthGuard>
                    <CustomerGuard>
                      <CustomerLayout />
                    </CustomerGuard>
                  </AuthGuard>
                }>
                  <Route path="/c/home" element={<CustomerHomePage />} />
                  <Route path="/c/dashboard" element={<CustomerHomePage />} />
                  <Route path="/c/merchants" element={<CustomerMerchantsPage />} />
                  <Route path="/c/market" element={<Navigate to="/c/home" replace />} />
                  <Route path="/c/orders" element={<CustomerOrdersPage />} />
                  <Route path="/c/wallet" element={<CustomerWalletPage />} />
                  <Route path="/c/notifications" element={<CustomerNotificationsPage />} />
                  <Route path="/c/chat" element={<CustomerChatPage />} />
                  <Route path="/c/settings" element={<CustomerSettingsPage />} />
                </Route>

                {/* App Shell — requires auth + approved profile + merchant profile */}
                <Route element={
                  <AuthGuard>
                    <ProfileGuard>
                      <AppLayout />
                    </ProfileGuard>
                  </AuthGuard>
                }>
                  {/* Trading */}
                  <Route path="/dashboard" element={<DashboardPage />} />
                  <Route path="/trading/orders" element={<OrdersPage />} />
                  <Route path="/trading/orders/import-ledger" element={<OrdersImportLedgerPage />} />
                  <Route path="/trading/stock" element={<StockPage />} />
                  <Route path="/trading/cash" element={<CashPage />} />
                  <Route path="/trading/calendar" element={<CalendarPage />} />
                  <Route path="/trading/p2p" element={<P2PTrackerPage />} />
                  <Route path="/merchants" element={<MerchantsPage />} />
                  <Route path="/merchants/:relationshipId" element={<RelationshipPage />} />
                  <Route path="/chat" element={<ChatPage />} />
                  <Route path="/marketplace" element={<MarketplacePage />} />

                  {/* Supporting */}
                  <Route path="/deals" element={<Navigate to="/merchants" replace />} />
                  {/* CRM split: customers moved into Orders' Customers tab, suppliers into Stock's Suppliers tab */}
                  <Route path="/crm" element={<Navigate to="/trading/orders?tab=customers" replace />} />
                  <Route path="/analytics" element={<Navigate to="/dashboard" replace />} />
                  <Route path="/settings" element={<SettingsPage />} />
                  <Route path="/notifications" element={<NotificationsPage />} />
                  <Route path="/messages" element={<MessagesPage />} />
                  <Route path="/invitations" element={<InvitationsPage />} />
                  <Route path="/approvals" element={<ApprovalsPage />} />
                  <Route path="/admin" element={<AdminPage />} />
                  <Route path="/admin/approvals" element={<AdminPage />} />
                  <Route path="/relationships" element={<RelationshipsPage />} />
                </Route>

                {/* Root redirect */}
                <Route path="/" element={<Navigate to="/dashboard" replace />} />

                {/* Legacy redirects */}
                <Route path="/trading" element={<Navigate to="/dashboard" replace />} />
                <Route path="/merchant" element={<Navigate to="/merchants" replace />} />
                <Route path="/merchant/*" element={<Navigate to="/merchants" replace />} />
                <Route path="/network" element={<Navigate to="/merchants" replace />} />
                <Route path="/network/*" element={<Navigate to="/merchants" replace />} />
                <Route path="/vault" element={<Navigate to="/trading/vault" replace />} />
                <Route path="/p2p" element={<Navigate to="/trading/p2p" replace />} />
                <Route path="/customer/orders" element={<Navigate to="/c/orders" replace />} />
                <Route path="/c/loan" element={<Navigate to="/c/orders" replace />} />

                {/* Catch-all */}
                <Route path="*" element={<NotFound />} />
              </Routes>
              </React.Suspense>
            </RouteErrorBoundary>
          </AuthProvider>
        </BrowserRouter>
      </TooltipProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
