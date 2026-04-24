import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Cloud, Download, Loader2, RefreshCw, Users, User } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import {
  adminUploadVaultBackup,
  adminGetLatestBackup,
  listVaultBackups,
} from '@/lib/supabase-vault';

interface UserRow {
  user_id: string;
  email: string;
  display_name?: string;
  status: string;
  backupCount?: number;
  lastBackup?: string;
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

      const rows: UserRow[] = (profiles || []).map(p => ({
        user_id: p.user_id,
        email: p.email,
        display_name: merchantMap.get(p.user_id) || p.email,
        status: p.status,
      }));

      // Enrich with backup counts (parallel, best effort)
      await Promise.all(
        rows.map(async r => {
          try {
            const list = await listVaultBackups(r.user_id);
            r.backupCount = list.length;
            r.lastBackup = list[0]?.createdAt;
          } catch {
            r.backupCount = 0;
          }
        }),
      );

      setUsers(rows);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      toast.error('Failed to load users: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  const snapshotForUser = async (userId: string): Promise<Record<string, unknown> | null> => {
    const [snap, orders, accounts, ledger] = await Promise.all([
      supabase.from('tracker_snapshots').select('state').eq('user_id', userId).maybeSingle(),
      supabase.from('customer_orders').select('*').or(`customer_user_id.eq.${userId},placed_by_user_id.eq.${userId}`).order('created_at', { ascending: false }).limit(200),
      supabase.from('cash_accounts').select('*').eq('user_id', userId),
      supabase.from('cash_ledger').select('*').eq('user_id', userId).order('ts', { ascending: false }).limit(500),
    ]);

    const trackerState = (snap.data?.state ?? {}) as Record<string, unknown>;
    if (!trackerState && !orders.data?.length && !accounts.data?.length) return null;

    return {
      _type: 'full_vault_backup',
      _ts: new Date().toISOString(),
      _trigger: 'admin backup',
      customer_orders: orders.data ?? [],
      cash_accounts_db: accounts.data ?? [],
      cash_ledger_db: ledger.data ?? [],
      ...trackerState,
    };
  };

  const backupSingleUser = async (user: UserRow) => {
    setPerUserLoading(prev => ({ ...prev, [user.user_id]: 'backup' }));
    try {
      const snapshot = await snapshotForUser(user.user_id);
      if (!snapshot) {
        toast.error(`No data to back up for ${user.display_name}`);
        return;
      }
      const res = await adminUploadVaultBackup(user.user_id, snapshot, 'Admin backup');
      if (!res.ok) throw new Error(res.error);
      toast.success(`✓ Backed up ${user.display_name}`);
      await loadUsers();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      toast.error(`Backup failed for ${user.display_name}: ${e.message}`);
    } finally {
      setPerUserLoading(prev => { const n = { ...prev }; delete n[user.user_id]; return n; });
    }
  };

  const restoreSingleUser = async (user: UserRow) => {
    if (!confirm(`Restore latest cloud backup for ${user.display_name}? This will overwrite tracker_snapshots for this user.`)) return;
    setPerUserLoading(prev => ({ ...prev, [user.user_id]: 'restore' }));
    try {
      const latest = await adminGetLatestBackup(user.user_id);
      if (!latest) {
        toast.error(`No backup found for ${user.display_name}`);
        return;
      }

      // Strip audit keys and DB-mirror keys before writing to tracker_snapshots.state
      const { _type, _ts, _trigger, customer_orders, cash_accounts_db, cash_ledger_db, ...trackerOnly } = latest.state;
      void _type; void _ts; void _trigger; void customer_orders; void cash_accounts_db; void cash_ledger_db;

      const { error } = await supabase
        .from('tracker_snapshots')
        .upsert({
          user_id: user.user_id,
          state: trackerOnly,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' });

      if (error) throw error;
      toast.success(`✓ Restored ${user.display_name} from ${latest.fileName}`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      toast.error(`Restore failed for ${user.display_name}: ${e.message}`);
    } finally {
      setPerUserLoading(prev => { const n = { ...prev }; delete n[user.user_id]; return n; });
    }
  };

  const backupAllUsers = async () => {
    if (!confirm(`Backup ALL ${users.length} users to Supabase vault? This may take a while.`)) return;
    setBulkAction('backup');
    let success = 0, fail = 0;
    for (const user of users) {
      try {
        const snapshot = await snapshotForUser(user.user_id);
        if (!snapshot) { fail++; continue; }
        const res = await adminUploadVaultBackup(user.user_id, snapshot, 'Admin bulk backup');
        if (!res.ok) { fail++; continue; }
        success++;
      } catch {
        fail++;
      }
    }
    setBulkAction(null);
    toast.success(`Bulk backup complete: ${success} ✓ / ${fail} ✗`);
    await loadUsers();
  };

  const restoreAllUsers = async () => {
    if (!confirm(`Restore ALL ${users.length} users from their latest cloud backup? This will overwrite tracker_snapshots.`)) return;
    setBulkAction('restore');
    let success = 0, fail = 0;
    for (const user of users) {
      try {
        const latest = await adminGetLatestBackup(user.user_id);
        if (!latest) { fail++; continue; }

        const { _type, _ts, _trigger, customer_orders, cash_accounts_db, cash_ledger_db, ...trackerOnly } = latest.state;
        void _type; void _ts; void _trigger; void customer_orders; void cash_accounts_db; void cash_ledger_db;

        const { error } = await supabase
          .from('tracker_snapshots')
          .upsert({
            user_id: user.user_id,
            state: trackerOnly,
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
            Backup or restore all approved users' tracker + orders + cash data via the Supabase Storage vault (<code className="text-[10px]">vault-backups</code> bucket). Each snapshot includes customer_orders, cash_accounts, cash_ledger, batches, trades, customers, and suppliers.
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
                        {user.backupCount !== undefined && (
                          <Badge variant="outline" className="text-[9px] px-1 py-0 h-4">
                            {user.backupCount} backup{user.backupCount === 1 ? '' : 's'}
                          </Badge>
                        )}
                      </div>
                      <span className="text-[10px] text-muted-foreground ml-5">
                        {user.email}
                        {user.lastBackup && ` · last: ${new Date(user.lastBackup).toLocaleString()}`}
                      </span>
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
                        disabled={!!userLoading || !!bulkAction || !user.backupCount}
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
