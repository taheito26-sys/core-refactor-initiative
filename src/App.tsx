import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/features/auth/auth-context";
import { AuthGuard } from "@/features/auth/guards/AuthGuard";
import { ProfileGuard } from "@/features/auth/guards/ProfileGuard";
import { AppLayout } from "@/components/layout/AppLayout";
import { createPlaceholderPage } from "@/components/shared/PlaceholderPage";
import { Loader2 } from "lucide-react";

// Auth pages
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

// Placeholder pages (will be replaced in later phases)
import DashboardPage from './pages/DashboardPage';
const OrdersPage = createPlaceholderPage('Orders', 'Manage your trades and orders');
const StockPage = createPlaceholderPage('Stock', 'Inventory and stock management');
const CalendarPage = createPlaceholderPage('Calendar', 'Schedule and events');
import P2PTrackerPage from './pages/P2PTrackerPage';
const CRMPage = createPlaceholderPage('CRM', 'Customer relationship management');
const NetworkPage = createPlaceholderPage('Network', 'Merchant directory and connections');
const DealsPage = createPlaceholderPage('Deals', 'Deal pipeline management');
const AnalyticsPage = createPlaceholderPage('Analytics', 'Performance analytics and insights');
const VaultPage = createPlaceholderPage('Vault', 'Secure document storage');
const SettingsPage = createPlaceholderPage('Settings', 'Account and platform settings');
const NotificationsPage = createPlaceholderPage('Notifications', 'Activity and alerts');
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

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-background p-8">
          <div className="text-center space-y-4">
            <h2 className="text-xl font-semibold text-foreground">This page could not be rendered.</h2>
            <p className="text-muted-foreground">
              Try refreshing the page. If the issue continues, the data source may be temporarily unavailable.
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
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <RouteErrorBoundary>
            <Routes>
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
                <Route path="/crm" element={<CRMPage />} />

                {/* Network */}
                <Route path="/network" element={<NetworkPage />} />
                <Route path="/network/:relationshipId" element={<RelationshipWorkspace />} />

                {/* Supporting */}
                <Route path="/deals" element={<DealsPage />} />
                <Route path="/analytics" element={<AnalyticsPage />} />
                <Route path="/vault" element={<VaultPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/notifications" element={<NotificationsPage />} />
                <Route path="/messages" element={<MessagesPage />} />
                <Route path="/invitations" element={<InvitationsPage />} />
                <Route path="/approvals" element={<ApprovalsPage />} />
                <Route path="/admin/approvals" element={<AdminApprovalsPage />} />
                <Route path="/relationships" element={<RelationshipsPage />} />
              </Route>

              {/* Root redirect */}
              <Route path="/" element={<Navigate to="/dashboard" replace />} />

              {/* Legacy redirects from repo */}
              <Route path="/trading" element={<Navigate to="/dashboard" replace />} />
              <Route path="/merchant" element={<Navigate to="/network" replace />} />
              <Route path="/merchant/*" element={<Navigate to="/network" replace />} />

              {/* Catch-all */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </RouteErrorBoundary>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
