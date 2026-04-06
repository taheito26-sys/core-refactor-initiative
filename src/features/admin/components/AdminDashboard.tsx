import { useAdminStats } from '../hooks/useAdminStats';
import { Skeleton } from '@/components/ui/skeleton';
import { Users, Briefcase, TrendingUp, Shield, Clock, CheckCircle, XCircle, DollarSign, Link2 } from 'lucide-react';

interface KpiItem {
  label: string;
  value: string | number;
  Icon: React.ElementType;
  accent?: string;
}

function KpiCard({ label, value, Icon, accent = 'rgba(99,102,241,0.15)' }: KpiItem) {
  return (
    <div style={{
      padding: '14px 16px',
      background: 'rgba(255,255,255,0.02)',
      border: '1px solid rgba(255,255,255,0.06)',
      borderRadius: 10,
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
    }}>
      <div style={{
        width: 28, height: 28, borderRadius: 7,
        background: accent,
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        <Icon style={{ width: 14, height: 14, color: 'rgba(255,255,255,0.7)' }} />
      </div>
      <div>
        <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--fg)', fontFamily: 'var(--mono, monospace)', letterSpacing: '-0.02em', lineHeight: 1 }}>
          {value}
        </div>
        <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 500, letterSpacing: '0.04em', textTransform: 'uppercase', marginTop: 4 }}>
          {label}
        </div>
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 10, marginTop: 4 }}>
      {children}
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

  if (!stats) return <p style={{ fontSize: 12, color: 'var(--muted)', padding: '20px 0' }}>Failed to load stats.</p>;

  const userCards: KpiItem[] = [
    { label: 'Total Users',  value: stats.total_users,    Icon: Users,       accent: 'rgba(99,102,241,0.15)' },
    { label: 'Approved',     value: stats.approved_users, Icon: CheckCircle, accent: 'rgba(34,197,94,0.15)'  },
    { label: 'Pending',      value: stats.pending_users,  Icon: Clock,       accent: 'rgba(234,179,8,0.15)'  },
    { label: 'Rejected',     value: stats.rejected_users, Icon: XCircle,     accent: 'rgba(239,68,68,0.15)'  },
    { label: 'Merchants',    value: stats.total_merchant_profiles, Icon: Shield, accent: 'rgba(99,102,241,0.12)' },
    { label: 'Relationships',value: stats.total_relationships,     Icon: Link2,  accent: 'rgba(99,102,241,0.12)' },
  ];

  const activityCards: KpiItem[] = [
    { label: 'Total Deals',     value: stats.total_deals,       Icon: Briefcase,  accent: 'rgba(99,102,241,0.15)' },
    { label: 'Pending Deals',   value: stats.deals_pending,     Icon: Clock,      accent: 'rgba(234,179,8,0.15)'  },
    { label: 'Active Deals',    value: stats.deals_active,      Icon: TrendingUp, accent: 'rgba(20,184,166,0.15)' },
    { label: 'Completed Deals', value: stats.deals_completed,   Icon: CheckCircle,accent: 'rgba(34,197,94,0.15)'  },
    { label: 'Total Settled',   value: `${Number(stats.total_settlement_amount).toLocaleString()}`, Icon: DollarSign, accent: 'rgba(139,92,246,0.15)' },
    { label: 'Total Profit',    value: `${Number(stats.total_profit_amount).toLocaleString()}`,    Icon: TrendingUp, accent: 'rgba(34,197,94,0.15)'  },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <SectionLabel>Users</SectionLabel>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
          {userCards.map(c => <KpiCard key={c.label} {...c} />)}
        </div>
      </div>
      <div style={{ height: 1, background: 'rgba(255,255,255,0.05)' }} />
      <div>
        <SectionLabel>Activity</SectionLabel>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
          {activityCards.map(c => <KpiCard key={c.label} {...c} />)}
        </div>
      </div>
    </div>
  );
}
