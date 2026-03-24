import { useState } from 'react';
import { useT } from '@/lib/i18n';
import { useAuth } from '@/features/auth/auth-context';
import { useDealCapital, useWithdrawFromPool } from '@/hooks/useDealCapital';
import { fmtU } from '@/lib/tracker-helpers';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import '@/styles/tracker.css';

interface Props {
  dealId: string;
  dealAmount: number;
  dealTitle: string;
  relationshipId: string;
  isPartner: boolean;
}

export function CapitalPoolPanel({ dealId, dealAmount, dealTitle, relationshipId, isPartner }: Props) {
  const t = useT();
  const { data: capital, isLoading } = useDealCapital(dealId, dealAmount);
  const withdraw = useWithdrawFromPool();
  const [showWithdraw, setShowWithdraw] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState('');

  const handleWithdraw = async () => {
    const amt = parseFloat(withdrawAmount);
    if (!amt || amt <= 0) { toast.error(t('invalidAmount')); return; }
    if (!capital || amt > capital.reinvestedPool) { toast.error(t('exceedsPoolBalance')); return; }
    try {
      await withdraw.mutateAsync({
        deal_id: dealId,
        relationship_id: relationshipId,
        amount: amt,
        currency: 'USDT',
        current_pool_balance: capital.reinvestedPool,
      });
      toast.success(t('withdrawnByPartner'));
      setShowWithdraw(false);
      setWithdrawAmount('');
    } catch (err: any) { toast.error(err.message); }
  };

  if (isLoading) {
    return <div className="empty"><div className="empty-t">{t('loading') || '...'}</div></div>;
  }

  if (!capital) return null;

  const typeIcon = (type: string) => type === 'reinvest' ? '🔄' : type === 'payout' ? '💰' : '📤';
  const typeLabel = (type: string) => type === 'reinvest' ? t('reinvestedToPool') : type === 'payout' ? t('paidOutToPartner') : t('withdrawnByPartner');

  return (
    <div className="panel" style={{ padding: 10, marginBottom: 10 }}>
      <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 8 }}>{dealTitle}</div>

      {/* KPI cards */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <div className="panel" style={{ flex: 1, padding: 8, textAlign: 'center' }}>
          <div style={{ fontSize: 9, color: 'var(--muted)' }}>{t('originalPrincipal')}</div>
          <div className="mono" style={{ fontSize: 13, fontWeight: 800 }}>{fmtU(capital.originalPrincipal)}</div>
        </div>
        <div className="panel" style={{ flex: 1, padding: 8, textAlign: 'center' }}>
          <div style={{ fontSize: 9, color: 'var(--muted)' }}>{t('reinvestedPool')}</div>
          <div className="mono" style={{ fontSize: 13, fontWeight: 800, color: capital.reinvestedPool > 0 ? 'var(--good)' : 'var(--muted)' }}>
            {fmtU(capital.reinvestedPool)}
          </div>
        </div>
        <div className="panel" style={{ flex: 1, padding: 8, textAlign: 'center' }}>
          <div style={{ fontSize: 9, color: 'var(--muted)' }}>{t('workingCapital')}</div>
          <div className="mono" style={{ fontSize: 13, fontWeight: 800 }}>{fmtU(capital.workingCapital)}</div>
        </div>
      </div>

      {/* Withdraw button for partner */}
      {isPartner && capital.reinvestedPool > 0 && (
        <button className="btn" onClick={() => setShowWithdraw(true)} style={{ fontSize: 10, marginBottom: 8 }}>
          📤 {t('withdrawFromPool')}
        </button>
      )}

      {/* Capital ledger */}
      {capital.ledger.length > 0 && (
        <>
          <div style={{ fontSize: 10, fontWeight: 700, marginBottom: 4 }}>{t('capitalLedger')}</div>
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>{t('type') || 'Type'}</th>
                  <th className="r">{t('amount')}</th>
                  <th>{t('notes')}</th>
                  <th className="r">{t('poolBalance')}</th>
                  <th>{t('date')}</th>
                </tr>
              </thead>
              <tbody>
                {capital.ledger.map(e => (
                  <tr key={e.id}>
                    <td style={{ fontSize: 10 }}>{typeIcon(e.type)} {typeLabel(e.type)}</td>
                    <td className="mono r" style={{ color: e.type === 'withdrawal' ? 'var(--bad)' : 'var(--good)' }}>
                      {e.type === 'withdrawal' ? '−' : '+'}{fmtU(e.amount)}
                    </td>
                    <td style={{ fontSize: 9, color: 'var(--muted)', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {e.note || '—'}
                    </td>
                    <td className="mono r">{fmtU(e.pool_balance_after)}</td>
                    <td className="mono" style={{ fontSize: 9 }}>{new Date(e.created_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Withdraw dialog */}
      <Dialog open={showWithdraw} onOpenChange={setShowWithdraw}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm">{t('withdrawFromPool')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div style={{ fontSize: 10, color: 'var(--muted)' }}>
              {t('poolBalance')}: <span className="mono" style={{ fontWeight: 700 }}>{fmtU(capital.reinvestedPool)}</span>
            </div>
            <div>
              <Label className="text-xs">{t('withdrawalAmount')}</Label>
              <Input
                type="number"
                value={withdrawAmount}
                onChange={e => setWithdrawAmount(e.target.value)}
                className="text-xs"
                max={capital.reinvestedPool}
              />
            </div>
            <Button size="sm" onClick={handleWithdraw} disabled={withdraw.isPending}>
              📤 {t('withdrawFromPool')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
