import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/features/auth/auth-context';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { KeyRound, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

export default function ResetPasswordPage() {
  const [email, setEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [isRecoveryMode, setIsRecoveryMode] = useState(false);
  const { resetPassword } = useAuth();

  useEffect(() => {
    // Check if this is a recovery callback (user clicked email link)
    const hash = window.location.hash;
    const query = window.location.search;
    const hasRecoveryInHash = hash && hash.includes('type=recovery');
    const hasRecoveryInQuery = new URLSearchParams(query).get('type') === 'recovery';

    if (hasRecoveryInHash || hasRecoveryInQuery) {
      console.info('[Auth] Password reset callback received', { hasRecoveryInHash, hasRecoveryInQuery });
      setIsRecoveryMode(true);
    }
  }, []);

  const handleRequestReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await resetPassword(email);
      toast.success('If an account exists with that email, a reset link has been sent.');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to process password reset request';
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 8) {
      toast.error('Password must be at least 8 characters');
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      toast.success('Password updated successfully! You can now sign in.');
      setIsRecoveryMode(false);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to update password';
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
            <KeyRound className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-2xl">Reset Password</CardTitle>
          <CardDescription>
            {isRecoveryMode
              ? 'Enter your new password below.'
              : 'Request a password recovery link.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isRecoveryMode ? (
            <form onSubmit={handleUpdatePassword} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="newPassword">New Password</Label>
                <Input
                  id="newPassword"
                  type="password"
                  placeholder="••••••••"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Update Password
              </Button>
            </form>
          ) : (
            <form onSubmit={handleRequestReset} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Request Password Reset
              </Button>
            </form>
          )}
          <p className="mt-4 text-center">
            <Button asChild variant="link">
              <Link to="/login">Return to Sign In</Link>
            </Button>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
