import { useState, lazy, Suspense } from 'react';
import { Loader2, Shield, LayoutDashboard, Users, FileText, CheckCircle, Bell, Cloud } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useIsAdmin } from '@/features/admin/hooks/useAdminProfiles';
import { AdminDashboard } from '@/features/admin/components/AdminDashboard';
import { AdminUserDirectory } from '@/features/admin/components/AdminUserDirectory';
import { AdminUserWorkspace } from '@/features/admin/components/AdminUserWorkspace';
import { AdminAuditCenter } from '@/features/admin/components/AdminAuditCenter';
import { AdminNotificationSender } from '@/features/admin/components/AdminNotificationSender';
import { AdminBackupManager } from '@/features/admin/components/AdminBackupManager';
import AdminApprovalsPage from './AdminApprovalsPage';

export default function AdminPage() {
  const { data: isAdmin, isLoading: roleLoading } = useIsAdmin();
  const [workspaceUserId, setWorkspaceUserId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('overview');

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

  // If workspace is open, show it full-screen
  if (workspaceUserId) {
    return (
      <div className="p-4">
        <AdminUserWorkspace userId={workspaceUserId} onBack={() => setWorkspaceUserId(null)} />
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Shield className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-bold text-foreground">Admin Control Center</h1>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="w-full justify-start flex-wrap h-auto gap-1">
          <TabsTrigger value="overview" className="text-xs gap-1">
            <LayoutDashboard className="h-3.5 w-3.5" /> Overview
          </TabsTrigger>
          <TabsTrigger value="users" className="text-xs gap-1">
            <Users className="h-3.5 w-3.5" /> Users
          </TabsTrigger>
          <TabsTrigger value="approvals" className="text-xs gap-1">
            <CheckCircle className="h-3.5 w-3.5" /> Approvals
          </TabsTrigger>
          <TabsTrigger value="notifications" className="text-xs gap-1">
            <Bell className="h-3.5 w-3.5" /> Notifications
          </TabsTrigger>
          <TabsTrigger value="audit" className="text-xs gap-1">
            <FileText className="h-3.5 w-3.5" /> Audit Log
          </TabsTrigger>
          <TabsTrigger value="backups" className="text-xs gap-1">
            <Cloud className="h-3.5 w-3.5" /> Backups
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <AdminDashboard />
        </TabsContent>

        <TabsContent value="users" className="mt-4">
          <AdminUserDirectory onOpenWorkspace={(uid) => setWorkspaceUserId(uid)} />
        </TabsContent>

        <TabsContent value="approvals" className="mt-4">
          <AdminApprovalsPage />
        </TabsContent>

        <TabsContent value="notifications" className="mt-4">
          <AdminNotificationSender />
        </TabsContent>

        <TabsContent value="audit" className="mt-4">
          <AdminAuditCenter />
        </TabsContent>

        <TabsContent value="backups" className="mt-4">
          <AdminBackupManager />
        </TabsContent>
      </Tabs>
    </div>
  );
}
