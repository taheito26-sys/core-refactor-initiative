import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/features/auth/auth-context";
import { AuthGuard } from "@/features/auth/guards/AuthGuard";
import { ProfileGuard } from "@/features/auth/guards/ProfileGuard";
import { ThemeProvider } from "@/lib/theme-context";
import { AppLayout } from "@/components/layout/AppLayout";
import { createPlaceholderPage } from "@/components/shared/PlaceholderPage";

// Auth pages
import OAuthCallbackPage from "./pages/auth/OAuthCallbackPage";
import LoginPage from "./pages/auth/LoginPage";
import SignupPage from "./pages/auth/SignupPage";
import VerifyEmailPage from "./pages/auth/VerifyEmailPage";
import ResetPasswordPage from "./pages/auth/ResetPasswordPage";
import PendingApprovalPage from "./pages/auth/PendingApprovalPage";
import AccountRejectedPage from "./pages/auth/AccountRejectedPage";

// Onboarding
import OnboardingPage from "./pages/merchant/OnboardingPage";

// Admin
import AdminApprovalsPage from "./pages/admin/AdminApprovalsPage";
import AdminPage from "./pages/admin/AdminPage";

// Core pages (exact repo copies)
import DashboardPage from './pages/DashboardPage';
import OrdersPage from './pages/OrdersPage';
import StockPage from './pages/StockPage';
import P2PTrackerPage from './pages/P2PTrackerPage';
import VaultPage from './pages/VaultPage';
import SettingsPage from './pages/SettingsPage';

// Placeholder pages (will be replaced in later phases)
import CalendarPage from './pages/CalendarPage';
import CRMPage from './pages/CRMPage';
import MerchantsPage from './pages/MerchantsPage';
import RelationshipPage from './pages/RelationshipPage';


import NotificationsPage from './pages/NotificationsPage';
const MessagesPage = createPlaceholderPage('Messages', 'Direct messages');
const InvitationsPage = createPlaceholderPage('Invitations', 'Manage invitations');
const ApprovalsPage = createPlaceholderPage('Approvals', 'Pending approvals');
const RelationshipsPage = createPlaceholderPage('Relationships', 'Manage relationships');
const RelationshipWorkspace = createPlaceholderPage('Workspace', 'Relationship workspace');

import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

class RouteErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.error('[RouteErrorBoundary] route render failed', error);
  }

  handleClearAndReload = async () => {
    try {
      // Unregister all service workers
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map(r => r.unregister()));
      }
      // Clear caches
      if ('caches' in window) {
        const names = await caches.keys();
        await Promise.all(names.map(n => caches.delete(n)));
      }
    } catch {
      // Best effort
    }
    window.location.reload();
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
        <Sonner />
        <BrowserRouter>
          <AuthProvider>
            <RouteErrorBoundary>
              <Routes>
                {/* OAuth callback — Supabase redirects here after Google consent */}
                <Route path="/auth/callback" element={<OAuthCallbackPage />} />

                {/* Auth — public */}
                <Route path="/login" element={<LoginPage />} />
                <Route path="/signup" element={<SignupPage />} />
                <Route path="/verify-email" element={<VerifyEmailPage />} />
                <Route path="/reset-password" element={<ResetPasswordPage />} />

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
                  <Route path="/trading/stock" element={<StockPage />} />
                  <Route path="/trading/calendar" element={<CalendarPage />} />
                  <Route path="/trading/p2p" element={<P2PTrackerPage />} />
                  <Route path="/trading/vault" element={<VaultPage />} />
                  <Route path="/crm" element={<CRMPage />} />
                  <Route path="/merchants" element={<MerchantsPage />} />
                  <Route path="/merchants/:relationshipId" element={<RelationshipPage />} />

                  {/* Supporting */}
                  <Route path="/deals" element={<Navigate to="/merchants" replace />} />
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

                {/* Catch-all */}
                <Route path="*" element={<NotFound />} />
              </Routes>
            </RouteErrorBoundary>
          </AuthProvider>
        </BrowserRouter>
      </TooltipProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
