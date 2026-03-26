/* ═══════════════════════════════════════════════════════════════
   ContextPanel — right column showing linked tracker data
   for the active conversation's counterparty
   ═══════════════════════════════════════════════════════════════ */

import { User, Package, FileText, Shield } from 'lucide-react';

interface Relationship {
  id: string;
  counterparty_name: string;
  counterparty_nickname: string;
  counterparty_code?: string;
  merchant_a_id: string;
  merchant_b_id: string;
}

interface Props {
  relationship: Relationship | null;
}

export function ContextPanel({ relationship }: Props) {
  if (!relationship) {
    return (
      <div style={{
        width: 280, flexShrink: 0, borderLeft: '1px solid var(--line)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'var(--muted)', fontSize: 12, padding: 20,
        background: 'var(--panel)',
      }}>
        Select a conversation to see details
      </div>
    );
  }

  return (
    <div style={{
      width: 280, flexShrink: 0, borderLeft: '1px solid var(--line)',
      overflowY: 'auto', background: 'var(--panel)', height: '100%',
    }}>
      {/* Merchant card */}
      <div style={{
        padding: 16, borderBottom: '1px solid var(--line)',
        textAlign: 'center',
      }}>
        <div style={{
          width: 56, height: 56, borderRadius: 50, margin: '0 auto 10px',
          background: 'color-mix(in srgb, var(--brand) 15%, transparent)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 20, fontWeight: 800, color: 'var(--brand)',
        }}>
          {relationship.counterparty_name.charAt(0).toUpperCase()}
        </div>
        <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>
          {relationship.counterparty_nickname || relationship.counterparty_name}
        </div>
        {relationship.counterparty_code && (
          <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>
            Code: {relationship.counterparty_code}
          </div>
        )}
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 6,
          fontSize: 10, fontWeight: 700, color: 'var(--good)',
          background: 'color-mix(in srgb, var(--good) 10%, transparent)',
          padding: '2px 8px', borderRadius: 4,
        }}>
          <span style={{ width: 6, height: 6, borderRadius: 50, background: 'var(--good)' }} />
          Active
        </div>
      </div>

      {/* Quick sections */}
      <Section icon={<Package size={14} />} title="Active Orders" badge="0">
        <div style={{ fontSize: 11, color: 'var(--muted)', padding: '8px 0' }}>
          No active orders with this merchant
        </div>
      </Section>

      <Section icon={<FileText size={14} />} title="Deals & Agreements" badge="0">
        <div style={{ fontSize: 11, color: 'var(--muted)', padding: '8px 0' }}>
          No active deals
        </div>
      </Section>

      <Section icon={<Shield size={14} />} title="Settlement State">
        <div style={{ fontSize: 11, color: 'var(--muted)', padding: '8px 0' }}>
          No pending settlements
        </div>
      </Section>

      {/* Quick actions */}
      <div style={{ padding: 16, borderTop: '1px solid var(--line)' }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Quick Actions
        </div>
        <ActionBtn label="+ New Order from Chat" />
        <ActionBtn label="+ Request Agreement" />
        <ActionBtn label="+ Initiate Settlement" />
      </div>
    </div>
  );
}

function Section({ icon, title, badge, children }: {
  icon: React.ReactNode; title: string; badge?: string; children: React.ReactNode;
}) {
  return (
    <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <span style={{ color: 'var(--brand)' }}>{icon}</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)', flex: 1 }}>{title}</span>
        {badge && (
          <span style={{
            fontSize: 9, fontWeight: 700, color: 'var(--muted)',
            background: 'var(--input-bg)', padding: '1px 6px', borderRadius: 4,
          }}>
            {badge}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

function ActionBtn({ label }: { label: string }) {
  return (
    <button style={{
      display: 'block', width: '100%', padding: '7px 10px', marginBottom: 4,
      fontSize: 11, fontWeight: 600, border: '1px solid var(--line)',
      borderRadius: 6, background: 'transparent', color: 'var(--text)',
      cursor: 'pointer', textAlign: 'left',
      transition: 'background 0.12s',
    }}>
      {label}
    </button>
  );
}
