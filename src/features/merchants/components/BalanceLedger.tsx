import { useT } from '@/lib/i18n';
import { useBalanceLedger, type BalanceEntry } from '@/hooks/useBalanceLedger';
import { fmtU, fmtQWithUnit, getWACOP } from '@/lib/tracker-helpers';
import { useTheme } from '@/lib/theme-context';
import { useTrackerState } from '@/lib/useTrackerState';
import { useMemo } from 'react';
import '@/styles/tracker.css';

function entryIcon(type: BalanceEntry['type']): string {
  switch (type) {
    case 'capital_in': return '💸';
    case 'capital_out': return '↩️';
    case 'reinvest': return '🔄';
    case 'payout': return '💰';
    case 'withdrawal': return '⬇️';
    default: return '•';
  }
}

function entrySign(type: BalanceEntry['type']): '+' | '−' | '' {
  switch (type) {
    case 'capital_in':
    case 'reinvest':
      return '+';
    case 'capital_out':
    case 'withdrawal':
      return '−';
    default:
      return '';
  }
}

function entryColor(type: BalanceEntry['type']): string {
  switch (type) {
    case 'capital_in':
    case 'reinvest':
      return 'var(--good)';
    case 'capital_out':
    case 'payout':
    case 'withdrawal':
      return 'var(--bad)';
    default:
      return 'var(--fg)';
  }
}

interface Props {
  relationshipId: string;
}

export function BalanceLedger({ relationshipId }: Props) {
  const t = useT();
  const { settings } = useTheme();
  const { data, isLoading } = useBalanceLedger(relationshipId);

  const { derived } = useTrackerState({});
  const wacop = useMemo(() => getWACOP(derived), [derived]);

  const entryLabel = (type: BalanceEntry['type'], costBasis?: number, note?: string | null): string => {
    switch (type) {
      case 'capital_in': return `${t('capitalInLabel')}${costBasis ? ` @ ${costBasis}` : ''}`;
      case 'capital_out': return `${t('capitalReturnLabel')}${costBasis ? ` @ ${costBasis}` : ''}`;
      case 'reinvest': return note || t('reinvestedLabel');
      case 'payout': return note || t('profitPaidOutLabel');
      case 'withdrawal': return note || t('withdrawalLabel');
      default: return note || type;
    }
  };

  if (isLoading) {
    return <div className="empty"><div className="empty-t">{t('loading')}</div></div>;
  }

  if (!data) return null;

  const { totalLent, totalReinvested, totalPaidOut, netBalance, entries } = data;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Summary row */}
      <div className="kpi-band">
        <div className="kpi-band-title">{t('balanceLedger')}</div>
        <div className="kpi-band-cols">
          <div>
            <div className="kpi-period">{t('totalLent')}</div>
            <div className="kpi-cell-val mono">{fmtQWithUnit(totalLent, settings.currency, wacop)}</div>
          </div>
          <div>
            <div className="kpi-period">{t('reinvestedPool')}</div>
            <div className="kpi-cell-val mono" style={{ color: totalReinvested > 0 ? 'var(--good)' : 'var(--muted)' }}>
              {fmtQWithUnit(totalReinvested, settings.currency, wacop)}
            </div>
          </div>
          <div>
            <div className="kpi-period">{t('payOut')}</div>
            <div className="kpi-cell-val mono" style={{ color: totalPaidOut > 0 ? 'var(--muted)' : 'var(--muted)' }}>
              {fmtQWithUnit(totalPaidOut, settings.currency, wacop)}
            </div>
          </div>
          <div>
            <div className="kpi-period">{t('netBalanceLabel')}</div>
            <div className="kpi-cell-val mono" style={{ fontWeight: 800, color: netBalance > 0 ? 'var(--good)' : 'var(--muted)' }}>
              {fmtQWithUnit(netBalance, settings.currency, wacop)}
            </div>
          </div>
        </div>
      </div>

      {/* Transaction history */}
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', borderBottom: '1px solid var(--line)', paddingBottom: 4 }}>
        {t('transactionHistory')}
      </div>

      {entries.length === 0 ? (
        <div className="empty">
          <div className="empty-t" style={{ fontSize: 11 }}>{t('noCapitalMovements')}</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {entries.map(e => {
            const sign = entrySign(e.type);
            const color = entryColor(e.type);
            return (
              <div
                key={e.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '6px 8px', borderRadius: 6,
                  background: 'var(--cardBg)',
                  fontSize: 11,
                }}
              >
                <span style={{ fontSize: 14, width: 20, textAlign: 'center' }}>{entryIcon(e.type)}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>{entryLabel(e.type, e.cost_basis, e.note)}</div>
                  <div style={{ fontSize: 9, color: 'var(--muted)' }}>
                    {new Date(e.created_at).toLocaleDateString()} {new Date(e.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="mono" style={{ color, fontWeight: 700, fontSize: 12 }}>
                    {sign}{fmtQWithUnit(e.amount, settings.currency, wacop)}
                  </div>
                  <div className="mono" style={{ fontSize: 9, color: 'var(--muted)' }}>
                    bal: {fmtQWithUnit(e.running_balance, settings.currency, wacop)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}