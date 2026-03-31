import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { focusElementBySelectors } from '@/lib/focus-target';
import { format } from 'date-fns';
import { Check, X, Shield, Loader2, Users } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import {
  useAdminProfiles,
  useApproveProfile,
  useRejectProfile,
  useIsAdmin,
  type PendingProfile,
} from '@/features/admin/hooks/useAdminProfiles';

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { variant: 'default' | 'secondary' | 'destructive' | 'outline'; label: string }> = {
    pending: { variant: 'outline', label: 'Pending' },
    approved: { variant: 'default', label: 'Approved' },
    rejected: { variant: 'destructive', label: 'Rejected' },
  };
  const cfg = map[status] ?? { variant: 'secondary' as const, label: status };
  return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
}

function RejectDialog({ profile, onReject }: { profile: PendingProfile; onReject: (reason: string) => void }) {
  const [reason, setReason] = useState('');
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="destructive" size="sm">
          <X className="mr-1 h-3.5 w-3.5" /> Reject
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Reject {profile.email}?</AlertDialogTitle>
          <AlertDialogDescription>
            This user will be denied access. Provide a reason.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Textarea
          placeholder="Reason for rejection…"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="min-h-[80px]"
        />
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={!reason.trim()}
            onClick={() => onReject(reason.trim())}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Confirm Rejection
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default function AdminApprovalsPage() {
  const { toast } = useToast();
  const [searchParams] = useSearchParams();
  const { data: isAdmin, isLoading: roleLoading } = useIsAdmin();
  const { data: profiles, isLoading } = useAdminProfiles();
  const approve = useApproveProfile();
  const reject = useRejectProfile();

  if (roleLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center py-20">
        <Card className="w-full max-w-sm text-center">
          <CardHeader>
            <Shield className="mx-auto h-10 w-10 text-destructive" />
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>You do not have admin privileges.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const pending = profiles?.filter((p) => p.status === 'pending') ?? [];
  const others = profiles?.filter((p) => p.status !== 'pending') ?? [];


  useEffect(() => {
    const focusApprovalId = searchParams.get('focusApprovalId');
    if (!focusApprovalId) return;
    window.setTimeout(() => {
      focusElementBySelectors([
        `#approval-${focusApprovalId}`,
        `[data-approval-id="${focusApprovalId}"]`,
      ]);
    }, 150);
  }, [searchParams, profiles]);

  const handleApprove = async (p: PendingProfile) => {
    try {
      await approve.mutateAsync(p.user_id);
      toast({ title: 'Approved', description: `${p.email} has been approved.` });
    } catch {
      toast({ title: 'Error', description: 'Failed to approve user.', variant: 'destructive' });
    }
  };

  const handleReject = async (p: PendingProfile, reason: string) => {
    try {
      await reject.mutateAsync({ profileUserId: p.user_id, reason });
      toast({ title: 'Rejected', description: `${p.email} has been rejected.` });
    } catch {
      toast({ title: 'Error', description: 'Failed to reject user.', variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-6">
      {/* Pending */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Pending Approvals</CardTitle>
            {pending.length > 0 && (
              <Badge variant="secondary" className="ml-auto">{pending.length}</Badge>
            )}
          </div>
          <CardDescription>Review and approve new user registrations.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : pending.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No pending accounts to review.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Registered</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pending.map((p) => (
                  <TableRow key={p.id} id={`approval-${p.id}`} data-approval-id={p.id}>
                    <TableCell className="font-medium">{p.email}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {format(new Date(p.created_at), 'MMM d, yyyy HH:mm')}
                    </TableCell>
                    <TableCell><StatusBadge status={p.status} /></TableCell>
                    <TableCell className="text-right space-x-2">
                      <Button
                        size="sm"
                        onClick={() => handleApprove(p)}
                        disabled={approve.isPending}
                      >
                        <Check className="mr-1 h-3.5 w-3.5" /> Approve
                      </Button>
                      <RejectDialog profile={p} onReject={(reason) => handleReject(p, reason)} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* History */}
      {others.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Account History</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Registered</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {others.map((p) => (
                  <TableRow key={p.id} id={`approval-${p.id}`} data-approval-id={p.id}>
                    <TableCell className="font-medium">{p.email}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {format(new Date(p.created_at), 'MMM d, yyyy HH:mm')}
                    </TableCell>
                    <TableCell><StatusBadge status={p.status} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
