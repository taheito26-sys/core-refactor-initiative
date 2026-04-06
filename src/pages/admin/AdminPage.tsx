import { useState } from 'react';
import { Loader2, LayoutDashboard, Users, CheckCircle, Bell, FileText, Cloud, Shield } from 'lucide-react';
import { useIsAdmin } from '@/features/admin/hooks/useAdminProfiles';
import { AdminDashboard } from '@/features/admin/components/AdminDashboard';
import { AdminUserDirectory } from '@/features/admin/components/AdminUserDirectory';
import { AdminUserWorkspace } from '@/features/admin/components/AdminUserWorkspace';
import { AdminAuditCenter } from '@/features/admin/components/AdminAuditCenter';
import { AdminNotificationSender } from '@/features/admin/components/AdminNotificationSender';
import { AdminBackupManager } from '@/features/admin/components/AdminBackupManager';
import AdminApprovalsPage from './AdminApprovalsPage';

const TABS = [
  { id: 'overview',      label: 'Overview',      Icon: LayoutDashboard },
  { id: 'users',         label: 'Users',          Icon: Users           },
  { id: 'approvals',     label: 'Approvals',      Icon: CheckCircle     },
  { id: 'notifications', label: 'Notifications',  Icon: Bell            },
  { id: 'audit',         label: 'Audit Log',      Icon: FileText        },
  { id: 'backups',       label: 'Backups',        Icon: Cloud           },
] as const;

type TabId = typeof TABS[number]['id'];

export default function AdminPage() {
  const { data: isAdmin, isLoading: roleLoading } = useIsAdmin();
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [workspaceUserId, setWorkspaceUserId] = useState<string | null>(null);

  if (roleLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 280 }}>
        <Loader2 style={{ width: 18, height: 18, animation: 'spin 1s linear infinite', color: 'var(--tracker-brand)' }} />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 320 }}>
        <div style={{
          textAlign: 'center', padding: '36px 48px',
          background: 'var(--tracker-panel)',
          border: '1px solid var(--tracker-line)',
          borderRadius: 'var(--lt-radius)',
          boxShadow: 'var(--lt-shadow)',
        }}>
          <Shield style={{ width: 28, height: 28, color: 'var(--tracker-bad)', margin: '0 auto 14px' }} />
          <div style={{ fontSize: 15, fontWeight: 400, color: 'var(--tracker-text)', letterSpacing: '-0.01em', marginBottom: 6 }}>
            Access Denied
          </div>
          <div style={{ fontSize: 11, color: 'var(--tracker-muted)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            Admin privileges required
          </div>
        </div>
      </div>
    );
  }

  if (workspaceUserId) {
    return (
      <div style={{ minHeight: '100%', padding: '18px 20px' }}>
        <AdminUserWorkspace userId={workspaceUserId} onBack={() => setWorkspaceUserId(null)} />
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100%', display: 'flex', flexDirection: 'column' }}>

      {/* ── Masthead ── */}
      <div style={{
        padding: '20px 24px 0',
        background: 'linear-gradient(180deg, color-mix(in srgb, var(--tracker-brand) 4%, transparent) 0%, transparent 100%)',
        borderBottom: '1px solid var(--tracker-line)',
      }}>
        {/* Title row */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 28, height: 28,
              borderRadius: 'var(--lt-radius-sm)',
              background: 'color-mix(in srgb, var(--tracker-brand) 12%, transparent)',
              border: '1px solid color-mix(in srgb, var(--tracker-brand) 22%, transparent)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}>
              <Shield style={{ width: 13, height: 13, color: 'var(--tracker-brand)' }} />
            </div>
            <span style={{ fontSize: 22, fontWeight: 400, color: 'var(--tracker-text)', letterSpacing: '-0.03em', lineHeight: 1 }}>
              Admin
            </span>
          </div>
          <div style={{
            fontSize: 9, fontWeight: 400,
            color: 'var(--tracker-brand)',
            letterSpacing: '0.18em', textTransform: 'uppercase',
            borderLeft: '1px solid color-mix(in srgb, var(--tracker-brand) 25%, transparent)',
            paddingLeft: 14,
          }}>
            Control Center
          </div>
        </div>

        {/* ── Tab rail ── */}
        <div style={{ display: 'flex', gap: 0, overflowX: 'auto', scrollbarWidth: 'none', marginBottom: -1 }}>
          {TABS.map(({ id, label, Icon }) => {
            const active = activeTab === id;
            return (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 7,
                  padding: '9px 16px',
                  fontSize: 11, fontWeight: 400,
                  letterSpacing: active ? '0.05em' : '0.02em',
                  textTransform: 'uppercase',
                  color: active ? 'var(--tracker-brand)' : 'var(--tracker-muted)',
                  background: active ? 'color-mix(in srgb, var(--tracker-brand) 6%, transparent)' : 'transparent',
                  border: 'none',
                  borderBottom: active ? '2px solid var(--tracker-brand)' : '2px solid transparent',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                  borderRadius: '2px 2px 0 0',
                  transition: 'color 0.15s, background 0.15s',
                  fontFamily: 'inherit',
                }}
              >
                <Icon style={{ width: 12, height: 12 }} />
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Content ── */}
      <div style={{ flex: 1, padding: '24px' }}>
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
