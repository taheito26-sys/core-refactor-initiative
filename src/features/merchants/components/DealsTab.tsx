import { useT } from '@/lib/i18n';
import { fmtU } from '@/lib/tracker-helpers';
import { DEAL_TYPE_CONFIGS } from '@/lib/deal-engine';
import '@/styles/tracker.css';

interface AgreementRow {
  id: string;
  relationship_id: string;
  title: string;
  deal_type: string;
  amount: number;
  currency: string;
  status: string;
  created_at: string;
  counterparty_name?: string;
}

interface Props {
  relationshipId: string;
  agreements: AgreementRow[];
}

/**
 * DealsTab — Read-only view of legacy merchant deals for a relationship.
 * All new order creation happens exclusively on the Orders page.
 */
export function DealsTab({ relationshipId, agreements }: Props) {
  const t = useT();

  const relDeals = agreements.filter(a => a.relationship_id === relationshipId && a.status !== 'cancelled');

  const dealTypeLabel = (dt: string) => {
    const cfg = DEAL_TYPE_CONFIGS[dt as keyof typeof DEAL_TYPE_CONFIGS];
    return cfg ? `${cfg.icon} ${cfg.label}` : dt;
  };

  const statusPill = (status: string) => {
    const cls = status === 'active' || status === 'approved' ? 'good'
      : status === 'pending' ? 'warn'
      : status === 'rejected' || status === 'cancelled' ? 'bad'
      : '';
    return <span className={`pill ${cls}`}>{status}</span>;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700 }}>{t('dealsLabel')}</div>
          <div style={{ fontSize: 10, color: 'var(--muted)' }}>{relDeals.length} {t('activeLabel') || 'active'}</div>
        </div>
      </div>

      {/* Info: orders are created from Orders page */}
      <div style={{
        padding: '8px 12px', borderRadius: 6, fontSize: 10, lineHeight: 1.5,
        background: 'color-mix(in srgb, var(--brand) 6%, transparent)',
        border: '1px solid color-mix(in srgb, var(--brand) 15%, transparent)',
        color: 'var(--muted)',
      }}>
        <strong style={{ color: 'var(--brand)' }}>{t('howItWorksAgreement')}</strong>{' '}
        {t('ordersPageOnlyExecution')}
      </div>

      {relDeals.length === 0 ? (
        <div className="empty">
          <div className="empty-t">{t('noDealsYet')}</div>
        </div>
      ) : (
        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>{t('title') || 'Title'}</th>
                <th>{t('type') || 'Type'}</th>
                <th>{t('settlementCadence')}</th>
                <th className="r">{t('amount')}</th>
                <th>{t('status')}</th>
                <th>{t('date')}</th>
              </tr>
            </thead>
            <tbody>
              {relDeals.map(d => (
                <tr key={d.id}>
                  <td style={{ fontWeight: 700, fontSize: 11 }}>{d.title}</td>
                  <td><span className="pill">{dealTypeLabel(d.deal_type)}</span></td>
                  <td>
                    {d.deal_type === 'capital_transfer' ? (
                      <span className="pill">💸 {t('capitalTransfer')}</span>
                    ) : (
                      <span className={`pill ${(d as any).settlement_cadence === 'per_order' ? 'warn' : ''}`}>
                        {(d as any).settlement_cadence === 'per_order' ? '⚡ ' + t('perTrade') : (d as any).settlement_cadence === 'weekly' ? '📆 ' + t('weekly') : '📅 ' + t('monthly')}
                      </span>
                    )}
                  </td>
                  <td className="mono r">{fmtU(d.amount)} {d.currency}</td>
                  <td>{statusPill(d.status)}</td>
                  <td className="mono" style={{ fontSize: 10 }}>{new Date(d.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
