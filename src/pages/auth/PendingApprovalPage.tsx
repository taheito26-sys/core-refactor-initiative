import { useAuth } from '@/features/auth/auth-context';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Clock, LogOut } from 'lucide-react';

export default function PendingApprovalPage() {
  const { logout, email } = useAuth();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md text-center">
        <CardHeader>
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
            <Clock className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-2xl">Account Pending Approval</CardTitle>
          <CardDescription>
            Your account ({email}) has been registered and is awaiting admin approval.
            You&apos;ll be notified once your account has been reviewed.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" className="w-full" onClick={logout}>
            <LogOut className="mr-2 h-4 w-4" />
            Sign Out
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
