import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/features/auth/auth-context";
import { AuthGuard } from "@/features/auth/guards/AuthGuard";
import { ProfileGuard } from "@/features/auth/guards/ProfileGuard";
import { Loader2 } from "lucide-react";

import LoginPage from "./pages/auth/LoginPage";
import SignupPage from "./pages/auth/SignupPage";
import VerifyEmailPage from "./pages/auth/VerifyEmailPage";
import ResetPasswordPage from "./pages/auth/ResetPasswordPage";
import PendingApprovalPage from "./pages/auth/PendingApprovalPage";
import AccountRejectedPage from "./pages/auth/AccountRejectedPage";
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

/** Placeholder for dashboard — will be replaced in Phase 3 */
function DashboardPlaceholder() {
  const { email, profile, merchantProfile, logout } = useAuth();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-8">
      <div className="text-center space-y-4 max-w-md">
        <h1 className="text-2xl font-bold text-foreground">Welcome to TRACKER</h1>
        <p className="text-muted-foreground">Signed in as {email}</p>
        <p className="text-sm text-muted-foreground">
          Profile status: {profile?.status ?? 'none'} | 
          Merchant: {merchantProfile?.display_name ?? 'Not set up'}
        </p>
        <button
          onClick={logout}
          className="px-4 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 text-sm"
        >
          Sign Out
        </button>
      </div>
    </div>
  );
}

/** Onboarding placeholder — will be replaced in Phase 3 */
function OnboardingPlaceholder() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-8">
      <div className="text-center space-y-4">
        <h1 className="text-2xl font-bold text-foreground">Merchant Onboarding</h1>
        <p className="text-muted-foreground">Onboarding page will be built in Phase 3.</p>
      </div>
    </div>
  );
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
              {/* Auth pages — public */}
              <Route path="/login" element={<LoginPage />} />
              <Route path="/signup" element={<SignupPage />} />
              <Route path="/verify-email" element={<VerifyEmailPage />} />
              <Route path="/reset-password" element={<ResetPasswordPage />} />

              {/* Pending approval — requires auth but not approval */}
              <Route path="/pending-approval" element={
                <AuthGuard><PendingApprovalPage /></AuthGuard>
              } />
              <Route path="/account-rejected" element={
                <AuthGuard><AccountRejectedPage /></AuthGuard>
              } />

              {/* Onboarding — requires auth + approved profile but no merchant profile */}
              <Route path="/onboarding" element={
                <AuthGuard><OnboardingPlaceholder /></AuthGuard>
              } />

              {/* App shell — requires auth + approved profile + merchant profile */}
              <Route path="/dashboard" element={
                <AuthGuard>
                  <ProfileGuard>
                    <DashboardPlaceholder />
                  </ProfileGuard>
                </AuthGuard>
              } />

              {/* Root redirect */}
              <Route path="/" element={<Navigate to="/dashboard" replace />} />

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
