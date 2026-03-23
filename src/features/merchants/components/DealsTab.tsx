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
  onCreateDeal?: () => void;
}

export function DealsTab({ relationshipId, agreements, onCreateDeal }: Props) {
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
        {onCreateDeal && (
          <button className="btn" onClick={onCreateDeal}>+ {t('newDeal')}</button>
        )}
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