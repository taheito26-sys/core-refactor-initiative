import { useAuth } from '@/features/auth/auth-context';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { XCircle, LogOut } from 'lucide-react';

export default function AccountRejectedPage() {
  const { logout, email, profile } = useAuth();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md text-center">
        <CardHeader>
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-destructive/10">
            <XCircle className="h-6 w-6 text-destructive" />
          </div>
          <CardTitle className="text-2xl">Account Not Approved</CardTitle>
          <CardDescription>
            Your account ({email}) was not approved for access to the platform.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {profile?.rejection_reason && (
            <p className="text-sm text-muted-foreground">
              Reason: {profile.rejection_reason}
            </p>
          )}
          <p className="text-sm text-muted-foreground">
            Please contact an administrator if you believe this is an error.
          </p>
          <Button variant="outline" className="w-full" onClick={logout}>
            <LogOut className="mr-2 h-4 w-4" />
            Sign Out
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
