import { ChevronDown, Box, FileText, CheckCircle2, FileSignature, Plus } from 'lucide-react';

interface Props {
  relationship: any;
}

export function ContextPanel({ relationship }: Props) {
  if (!relationship) return null;

  const { counterparty_name, counterparty_code } = relationship;

  const getAvatarColor = (name: string) => {
    const hash = name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const colors = ['#059669', '#2563eb', '#db2777', '#d97706', '#7c3aed'];
    return colors[hash % colors.length];
  };

  const AccordionHeader = ({ icon: Icon, title, count }: { icon: any, title: string, count: number }) => (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '16px 20px', borderBottom: '1px solid #e5e7eb', cursor: 'pointer',
      color: '#4b5563'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Icon size={16} />
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.5px' }}>{title}</span>
      </div>
      <div style={{ fontSize: 12, fontWeight: 800, color: '#111827' }}>{count}</div>
      {/* Expand/collapse chevron can go here, but omitted for simplicity matching design */}
    </div>
  );

  const QuickAction = ({ icon: Icon, label }: { icon: any, label: string }) => (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12, padding: '10px 20px',
      color: '#6366f1', fontSize: 13, fontWeight: 600, cursor: 'pointer',
    }}>
      <Icon size={16} />
      {label}
    </div>
  );

  return (
    <div style={{
      width: 320, flexShrink: 0, borderLeft: '1px solid #e5e7eb',
      background: '#ffffff', display: 'flex', flexDirection: 'column',
      height: '100%', overflowY: 'auto'
    }}>
      {/* Profile Header */}
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        padding: '32px 20px', borderBottom: '1px solid #e5e7eb'
      }}>
        <div style={{
          width: 80, height: 80, borderRadius: '50%',
          background: getAvatarColor(counterparty_name), color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 32, fontWeight: 700, marginBottom: 16
        }}>
          {counterparty_name.charAt(0).toUpperCase()}
        </div>
        <div style={{ fontSize: 18, fontWeight: 800, color: '#111827', marginBottom: 4 }}>
          {counterparty_name}
        </div>
        <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 8 }}>
          Code: {counterparty_code || '8199'}
        </div>
        <div style={{ fontSize: 12, color: '#059669', fontWeight: 600 }}>
          Active
        </div>
      </div>

      {/* ACTIVE ORDERS */}
      <div style={{ borderBottom: '1px solid #e5e7eb', paddingBottom: 16 }}>
        <AccordionHeader icon={Box} title="ACTIVE ORDERS" count={0} />
        <div style={{ padding: '8px 20px', fontSize: 12, color: '#6b7280' }}>
          No active orders with this merchant
        </div>
      </div>

      {/* DEALS & AGREEMENTS */}
      <div style={{ borderBottom: '1px solid #e5e7eb', paddingBottom: 16 }}>
        <AccordionHeader icon={FileSignature} title="DEALS & AGREEMENTS" count={0} />
        <div style={{ padding: '8px 20px', fontSize: 12, color: '#6b7280' }}>
          No active deals
        </div>
      </div>

      {/* SETTLEMENT STATE */}
      <div style={{ borderBottom: '1px solid #e5e7eb', paddingBottom: 16 }}>
        <AccordionHeader icon={CheckCircle2} title="SETTLEMENT STATE" count={2} />
        <div style={{ padding: '12px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[1, 2].map((i) => (
            <div key={i} style={{
              background: '#fef9c3', // faint yellow matching screenshot
              borderRadius: 6, padding: '12px 16px',
              border: '1px solid #fef08a'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#111827' }}>2026-03</span>
                <span style={{ fontSize: 11, color: '#d97706', fontWeight: 600 }}>Pending</span>
              </div>
              <div style={{ fontSize: 12, color: '#4b5563' }}>
                Net: 0
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* QUICK ACTIONS */}
      <div style={{ padding: '20px 0' }}>
        <div style={{
          fontSize: 11, fontWeight: 700, letterSpacing: '0.5px',
          color: '#6b7280', padding: '0 20px', marginBottom: 12
        }}>
          QUICK ACTIONS
        </div>
        <QuickAction icon={Plus} label="New Order from Chat" />
        <QuickAction icon={Plus} label="Request Agreement" />
        <QuickAction icon={Plus} label="Initiate Settlement" />
      </div>

    </div>
  );
}
