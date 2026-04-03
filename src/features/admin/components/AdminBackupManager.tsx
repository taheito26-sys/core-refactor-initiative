import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Cloud, Download, Loader2, RefreshCw, Users, User } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { rawGasPost } from '@/lib/gas-cloud';

interface UserRow {
  user_id: string;
  email: string;
  display_name?: string;
  status: string;
  hasBackup?: boolean;
  lastBackup?: string;
}

function deterministicPassword(userId: string) {
  return `taheito_${userId}_cloud_2026`;
}

async function ensureGasSession(email: string, userId: string, name?: string): Promise<{ email: string; token: string } | null> {
  const pw = deterministicPassword(userId);
  // Try login
  try {
    const res = await rawGasPost({ action: 'login', email, password: pw });
    if (res?.ok && res.token) return { email, token: res.token };
  } catch {}
  // Try register
  try {
    const res = await rawGasPost({ action: 'register', email, password: pw, name: name || email.split('@')[0] });
    if (res?.ok && res.token) return { email, token: res.token };
  } catch {}
  return null;
}

async function backupForUser(email: string, token: string, state: Record<string, unknown>, label: string) {
  return rawGasPost({
    action: 'backup',
    email,
    token,
    exportedAt: new Date().toISOString(),
    state,
    label,
  });
}

async function restoreForUser(email: string, token: string) {
  return rawGasPost({
    action: 'restore',
    email,
    token,
  });
}

export function AdminBackupManager() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [bulkAction, setBulkAction] = useState<string | null>(null);
  const [perUserLoading, setPerUserLoading] = useState<Record<string, string>>({});

  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    setLoading(true);
    try {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, email, status')
        .eq('status', 'approved');

      const { data: merchants } = await supabase
        .from('merchant_profiles')
        .select('user_id, display_name');

      const merchantMap = new Map((merchants || []).map(m => [m.user_id, m.display_name]));

      setUsers((profiles || []).map(p => ({
        user_id: p.user_id,
        email: p.email,
        display_name: merchantMap.get(p.user_id) || p.email,
        status: p.status,
      })));
    } catch (e: any) {
      toast.error('Failed to load users: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  const backupSingleUser = async (user: UserRow) => {
    setPerUserLoading(prev => ({ ...prev, [user.user_id]: 'backup' }));
    try {
      // Get their tracker state from DB
      const { data } = await supabase
        .from('tracker_snapshots')
        .select('state')
        .eq('user_id', user.user_id)
        .maybeSingle();

      if (!data?.state) {
        toast.error(`No tracker data for ${user.display_name}`);
        return;
      }

      const session = await ensureGasSession(user.email, user.user_id, user.display_name);
      if (!session) {
        toast.error(`Cloud auth failed for ${user.display_name}`);
        return;
      }

      await backupForUser(session.email, session.token, data.state as Record<string, unknown>, `Admin backup — ${new Date().toISOString()}`);
      toast.success(`✓ Backed up ${user.display_name}`);
    } catch (e: any) {
      toast.error(`Backup failed for ${user.display_name}: ${e.message}`);
    } finally {
      setPerUserLoading(prev => { const n = { ...prev }; delete n[user.user_id]; return n; });
    }
  };

  const restoreSingleUser = async (user: UserRow) => {
    if (!confirm(`Restore cloud backup for ${user.display_name}? This will overwrite their current tracker data in the database.`)) return;
    setPerUserLoading(prev => ({ ...prev, [user.user_id]: 'restore' }));
    try {
      const session = await ensureGasSession(user.email, user.user_id, user.display_name);
      if (!session) {
        toast.error(`Cloud auth failed for ${user.display_name}`);
        return;
      }

      const res = await restoreForUser(session.email, session.token);
      if (!res?.state) {
        toast.error(`No cloud backup found for ${user.display_name}`);
        return;
      }

      // Write to tracker_snapshots via admin RPC or direct update
      // Since admin has RLS access, use upsert
      const { error } = await supabase
        .from('tracker_snapshots')
        .upsert({
          user_id: user.user_id,
          state: res.state,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' });

      if (error) throw error;
      toast.success(`✓ Restored ${user.display_name} from cloud backup`);
    } catch (e: any) {
      toast.error(`Restore failed for ${user.display_name}: ${e.message}`);
    } finally {
      setPerUserLoading(prev => { const n = { ...prev }; delete n[user.user_id]; return n; });
    }
  };

  const backupAllUsers = async () => {
    if (!confirm(`Backup ALL ${users.length} users to cloud? This may take a while.`)) return;
    setBulkAction('backup');
    let success = 0, fail = 0;
    for (const user of users) {
      try {
        const { data } = await supabase
          .from('tracker_snapshots')
          .select('state')
          .eq('user_id', user.user_id)
          .maybeSingle();

        if (!data?.state) { fail++; continue; }

        const session = await ensureGasSession(user.email, user.user_id, user.display_name);
        if (!session) { fail++; continue; }

        await backupForUser(session.email, session.token, data.state as Record<string, unknown>, `Admin bulk backup — ${new Date().toISOString()}`);
        success++;
      } catch {
        fail++;
      }
    }
    setBulkAction(null);
    toast.success(`Bulk backup complete: ${success} ✓ / ${fail} ✗`);
  };

  const restoreAllUsers = async () => {
    if (!confirm(`Restore ALL ${users.length} users from cloud backups? This will overwrite their current data.`)) return;
    setBulkAction('restore');
    let success = 0, fail = 0;
    for (const user of users) {
      try {
        const session = await ensureGasSession(user.email, user.user_id, user.display_name);
        if (!session) { fail++; continue; }

        const res = await restoreForUser(session.email, session.token);
        if (!res?.state) { fail++; continue; }

        const { error } = await supabase
          .from('tracker_snapshots')
          .upsert({
            user_id: user.user_id,
            state: res.state,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'user_id' });

        if (error) { fail++; continue; }
        success++;
      } catch {
        fail++;
      }
    }
    setBulkAction(null);
    toast.success(`Bulk restore complete: ${success} ✓ / ${fail} ✗`);
  };

  return (
    <div className="space-y-4">
      {/* Bulk actions */}
      <Card className="glass">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-display flex items-center gap-2">
              <Cloud className="h-4 w-4" /> Cloud Backup Manager
            </CardTitle>
            <Badge variant="outline" className="text-[10px]">{users.length} users</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-[11px] text-muted-foreground">
            Backup or restore tracker data for all approved users via Google Drive cloud storage. Each user's data is stored under their own cloud account.
          </p>

          <div className="flex gap-2 flex-wrap">
            <Button
              size="sm"
              onClick={backupAllUsers}
              disabled={!!bulkAction || users.length === 0}
            >
              {bulkAction === 'backup' ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Cloud className="w-3 h-3 mr-1" />}
              Backup All Users
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={restoreAllUsers}
              disabled={!!bulkAction || users.length === 0}
            >
              {bulkAction === 'restore' ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Download className="w-3 h-3 mr-1" />}
              Restore All Users
            </Button>
            <Button variant="outline" size="sm" onClick={loadUsers} disabled={loading}>
              <RefreshCw className={`w-3 h-3 mr-1 ${loading ? 'animate-spin' : ''}`} /> Refresh
            </Button>
          </div>

          {bulkAction && (
            <div className="flex items-center gap-2 text-[11px] text-primary">
              <Loader2 className="w-3 h-3 animate-spin" />
              {bulkAction === 'backup' ? 'Backing up all users…' : 'Restoring all users…'} Please wait.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Per-user list */}
      <Card className="glass">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-display flex items-center gap-2">
            <Users className="h-4 w-4" /> Per-User Backup & Restore
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : users.length === 0 ? (
            <p className="text-[11px] text-muted-foreground py-4">No approved users found.</p>
          ) : (
            <div className="space-y-1 max-h-[500px] overflow-y-auto">
              {users.map(user => {
                const userLoading = perUserLoading[user.user_id];
                return (
                  <div key={user.user_id} className="flex items-center justify-between gap-2 py-2 px-2 rounded-md hover:bg-muted/30 border-b border-border/30">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <User className="h-3 w-3 text-muted-foreground shrink-0" />
                        <span className="text-[11px] font-medium truncate">{user.display_name}</span>
                      </div>
                      <span className="text-[10px] text-muted-foreground ml-5">{user.email}</span>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-[9px] px-2"
                        disabled={!!userLoading || !!bulkAction}
                        onClick={() => backupSingleUser(user)}
                      >
                        {userLoading === 'backup' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Cloud className="w-3 h-3 mr-0.5" />}
                        Backup
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-[9px] px-2"
                        disabled={!!userLoading || !!bulkAction}
                        onClick={() => restoreSingleUser(user)}
                      >
                        {userLoading === 'restore' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3 mr-0.5" />}
                        Restore
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
