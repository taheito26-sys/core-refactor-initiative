import { useState } from 'react';
import { Loader2, Shield, LayoutDashboard, Users, FileText, CheckCircle, Bell, Cloud } from 'lucide-react';
import { useIsAdmin } from '@/features/admin/hooks/useAdminProfiles';
import { AdminDashboard } from '@/features/admin/components/AdminDashboard';
import { AdminUserDirectory } from '@/features/admin/components/AdminUserDirectory';
import { AdminUserWorkspace } from '@/features/admin/components/AdminUserWorkspace';
import { AdminAuditCenter } from '@/features/admin/components/AdminAuditCenter';
import { AdminNotificationSender } from '@/features/admin/components/AdminNotificationSender';
import { AdminBackupManager } from '@/features/admin/components/AdminBackupManager';
import AdminApprovalsPage from './AdminApprovalsPage';

const TABS = [
  { id: 'overview',       label: 'Overview',       Icon: LayoutDashboard },
  { id: 'users',          label: 'Users',           Icon: Users           },
  { id: 'approvals',      label: 'Approvals',       Icon: CheckCircle     },
  { id: 'notifications',  label: 'Notifications',   Icon: Bell            },
  { id: 'audit',          label: 'Audit Log',       Icon: FileText        },
  { id: 'backups',        label: 'Backups',         Icon: Cloud           },
] as const;

export default function AdminPage() {
  const { data: isAdmin, isLoading: roleLoading } = useIsAdmin();
  const [workspaceUserId, setWorkspaceUserId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<typeof TABS[number]['id']>('overview');

  if (roleLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 240 }}>
        <Loader2 style={{ width: 20, height: 20, animation: 'spin 1s linear infinite', color: 'var(--muted)' }} />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 300 }}>
        <div style={{
          textAlign: 'center', padding: '32px 40px',
          background: 'rgba(255,255,255,0.02)',
          border: '1px solid rgba(255,255,255,0.07)',
          borderRadius: 12,
        }}>
          <Shield style={{ width: 32, height: 32, color: 'var(--bad)', margin: '0 auto 12px' }} />
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg)', marginBottom: 6 }}>Access Denied</div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>You don't have admin privileges.</div>
        </div>
      </div>
    );
  }

  if (workspaceUserId) {
    return (
      <div style={{ padding: '16px 20px' }}>
        <AdminUserWorkspace userId={workspaceUserId} onBack={() => setWorkspaceUserId(null)} />
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100%', background: 'var(--bg, #0d0e14)' }}>

      {/* ── Header ── */}
      <div style={{
        padding: '18px 20px 0',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <div style={{
            width: 28, height: 28, borderRadius: 8,
            background: 'rgba(99,102,241,0.12)',
            border: '1px solid rgba(99,102,241,0.2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Shield style={{ width: 14, height: 14, color: '#818cf8' }} />
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--fg)', letterSpacing: '-0.01em', lineHeight: 1.2 }}>
              Admin
            </div>
            <div style={{ fontSize: 10, color: 'var(--muted)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
              Control Center
            </div>
          </div>
        </div>

        {/* ── Tab Nav ── */}
        <div style={{ display: 'flex', gap: 0, overflowX: 'auto', scrollbarWidth: 'none' }}>
          {TABS.map(({ id, label, Icon }) => {
            const active = activeTab === id;
            return (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '8px 14px',
                  fontSize: 12,
                  fontWeight: active ? 600 : 400,
                  color: active ? 'var(--fg)' : 'var(--muted)',
                  background: 'transparent',
                  border: 'none',
                  borderBottom: active ? '2px solid #818cf8' : '2px solid transparent',
                  marginBottom: -1,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  transition: 'color 0.15s ease, border-color 0.15s ease',
                  flexShrink: 0,
                }}
              >
                <Icon style={{ width: 13, height: 13, opacity: active ? 1 : 0.6 }} />
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Content ── */}
      <div style={{ padding: '20px' }}>
        {activeTab === 'overview'      && <AdminDashboard />}
        {activeTab === 'users'         && <AdminUserDirectory onOpenWorkspace={uid => setWorkspaceUserId(uid)} />}
        {activeTab === 'approvals'     && <AdminApprovalsPage />}
        {activeTab === 'notifications' && <AdminNotificationSender />}
        {activeTab === 'audit'         && <AdminAuditCenter />}
        {activeTab === 'backups'       && <AdminBackupManager />}
      </div>

    </div>
  );
}
