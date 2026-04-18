import { useAdminStats } from '../hooks/useAdminStats';
import { Skeleton } from '@/components/ui/skeleton';
import { Users, Briefcase, TrendingUp, Shield, Clock, CheckCircle, XCircle, DollarSign, Link2 } from 'lucide-react';

interface KpiItem {
  label: string;
  value: string | number;
  Icon: React.ElementType;
  tint: string;
}

function KpiCard({ label, value, Icon, tint }: KpiItem) {
  return (
    <div style={{
      padding: '14px 16px',
      background: 'var(--tracker-panel)',
      border: '1px solid var(--tracker-line)',
      borderRadius: 'var(--lt-radius)',
      display: 'flex', flexDirection: 'column', gap: 10,
      boxShadow: 'var(--lt-shadow)',
    }}>
      <div style={{
        width: 28, height: 28,
        borderRadius: 'var(--lt-radius-sm)',
        background: tint,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon style={{ width: 13, height: 13, color: 'var(--tracker-text)', opacity: 0.75 }} />
      </div>
      <div>
        <div style={{
          fontSize: 22, fontWeight: 400,
          color: 'var(--tracker-text)',
          fontFamily: 'var(--lt-font-mono, monospace)',
          letterSpacing: '-0.03em', lineHeight: 1,
        }}>
          {value}
        </div>
        <div style={{
          fontSize: 9, color: 'var(--tracker-muted)',
          fontWeight: 400, letterSpacing: '0.08em',
          textTransform: 'uppercase', marginTop: 5,
        }}>
          {label}
        </div>
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 9, fontWeight: 400, letterSpacing: '0.12em',
      textTransform: 'uppercase', color: 'var(--tracker-muted)',
      marginBottom: 12, marginTop: 4,
      display: 'flex', alignItems: 'center', gap: 10,
    }}>
      {children}
      <div style={{ flex: 1, height: 1, background: 'var(--tracker-line)' }} />
    </div>
  );
}

export function AdminDashboard() {
  const { data: stats, isLoading } = useAdminStats();

  if (isLoading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
          {Array.from({ length: 12 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
      </div>
    );
  }

  if (!stats) return (
    <p style={{ fontSize: 12, color: 'var(--tracker-muted)', padding: '20px 0' }}>Failed to load stats.</p>
  );

  const userCards: KpiItem[] = [
    { label: 'Total Users',   value: stats.total_users,             Icon: Users,       tint: 'color-mix(in srgb, var(--tracker-brand) 14%, transparent)' },
    { label: 'Approved',      value: stats.approved_users,          Icon: CheckCircle, tint: 'color-mix(in srgb, var(--tracker-good) 14%, transparent)'  },
    { label: 'Pending',       value: stats.pending_users,           Icon: Clock,       tint: 'color-mix(in srgb, var(--tracker-warn) 14%, transparent)'  },
    { label: 'Rejected',      value: stats.rejected_users,          Icon: XCircle,     tint: 'color-mix(in srgb, var(--tracker-bad) 14%, transparent)'   },
    { label: 'Merchants',     value: stats.total_merchant_profiles, Icon: Shield,      tint: 'color-mix(in srgb, var(--tracker-brand) 10%, transparent)' },
    { label: 'Relationships', value: stats.total_relationships,     Icon: Link2,       tint: 'color-mix(in srgb, var(--tracker-brand2) 12%, transparent)' },
  ];

  const activityCards: KpiItem[] = [
    { label: 'Total Deals',     value: stats.total_deals,                                                  Icon: Briefcase,   tint: 'color-mix(in srgb, var(--tracker-brand) 14%, transparent)'  },
    { label: 'Pending Deals',   value: stats.deals_pending,                                                Icon: Clock,       tint: 'color-mix(in srgb, var(--tracker-warn) 14%, transparent)'  },
    { label: 'Active Deals',    value: stats.deals_active,                                                 Icon: TrendingUp,  tint: 'color-mix(in srgb, var(--tracker-good) 14%, transparent)'  },
    { label: 'Completed',       value: stats.deals_completed,                                              Icon: CheckCircle, tint: 'color-mix(in srgb, var(--tracker-good) 12%, transparent)'  },
    { label: 'Settled',         value: Number(stats.total_settlement_amount).toLocaleString(),             Icon: DollarSign,  tint: 'color-mix(in srgb, var(--tracker-brand2) 14%, transparent)' },
    { label: 'Total Profit',    value: Number(stats.total_profit_amount).toLocaleString(),                 Icon: TrendingUp,  tint: 'color-mix(in srgb, var(--tracker-good) 14%, transparent)'  },
    { label: 'App Sessions',    value: stats.total_app_sessions,                                           Icon: Clock,       tint: 'color-mix(in srgb, var(--tracker-brand) 12%, transparent)'  },
    { label: 'Active 30d',      value: stats.active_app_users_30d,                                         Icon: Users,       tint: 'color-mix(in srgb, var(--tracker-brand2) 12%, transparent)' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div>
        <SectionLabel>Users</SectionLabel>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
          {userCards.map(c => <KpiCard key={c.label} {...c} />)}
        </div>
      </div>
      <div>
        <SectionLabel>Activity</SectionLabel>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
          {activityCards.map(c => <KpiCard key={c.label} {...c} />)}
        </div>
      </div>
    </div>
  );
}
