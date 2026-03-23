import { useState } from 'react';
import { useT } from '@/lib/i18n';
import { useAuth } from '@/features/auth/auth-context';
import { useSettlements, useSubmitSettlement, useApproveSettlement } from '@/hooks/useSettlements';
import { fmtU } from '@/lib/tracker-helpers';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import '@/styles/tracker.css';

interface Props {
  relationshipId: string;
  deals: { id: string; title: string }[];
}

export function SettlementTab({ relationshipId, deals }: Props) {
  const t = useT();
  const { userId } = useAuth();
  const { data: settlements, isLoading } = useSettlements(relationshipId);
  const submitSettlement = useSubmitSettlement();
  const approveSettlement = useApproveSettlement();
  const [showForm, setShowForm] = useState(false);
  const [formDealId, setFormDealId] = useState('');
  const [formAmount, setFormAmount] = useState('');
  const [formNotes, setFormNotes] = useState('');

  const handleSubmit = async () => {
    if (!formDealId || !formAmount) {
      toast.error('Deal and amount are required');
      return;
    }
    try {
      await submitSettlement.mutateAsync({
        deal_id: formDealId,
        relationship_id: relationshipId,
        amount: parseFloat(formAmount),
        currency: 'USDT',
        notes: formNotes || undefined,
      });
      toast.success(t('settlementSubmitted'));
      setShowForm(false);
      setFormDealId('');
      setFormAmount('');
      setFormNotes('');
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleApprove = async (id: string, approved: boolean) => {
    try {
      await approveSettlement.mutateAsync({ id, approved });
      toast.success(approved ? t('approvedMutation') : t('rejectedNoMutation'));
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const statusPill = (status: string) => {
    const cls = status === 'approved' ? 'good' : status === 'rejected' ? 'bad' : 'warn';
    return <span className={`pill ${cls}`}>{status}</span>;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 12, fontWeight: 700 }}>{t('settlements')}</div>
        <button className="btn" onClick={() => setShowForm(true)}>+ {t('submitSettlementAction')}</button>
      </div>

      {isLoading ? (
        <div className="empty"><div className="empty-t">{t('loading') || '...'}</div></div>
      ) : !settlements?.length ? (
        <div className="empty">
          <div className="empty-t">{t('noDeals')}</div>
        </div>
      ) : (
        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>{t('date')}</th>
                <th>{t('title') || 'Deal'}</th>
                <th className="r">{t('amount')}</th>
                <th>{t('status')}</th>
                <th>{t('notes')}</th>
                <th>{t('actions')}</th>
              </tr>
            </thead>
            <tbody>
              {settlements.map(s => (
                <tr key={s.id}>
                  <td className="mono" style={{ fontSize: 10 }}>{new Date(s.created_at).toLocaleDateString()}</td>
                  <td style={{ fontSize: 11 }}>{s.deal_title || '—'}</td>
                  <td className="mono r">{fmtU(s.amount)} {s.currency}</td>
                  <td>{statusPill(s.status)}</td>
                  <td style={{ fontSize: 10, color: 'var(--muted)', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.notes || '—'}
                  </td>
                  <td>
                    {s.status === 'pending' && s.settled_by !== userId && (
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button className="rowBtn" onClick={() => handleApprove(s.id, true)}>✓</button>
                        <button className="rowBtn" onClick={() => handleApprove(s.id, false)}>✗</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm">{t('submitSettlementAction')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">{t('deals') || 'Deal'}</Label>
              <select
                value={formDealId}
                onChange={e => setFormDealId(e.target.value)}
                className="w-full mt-1 p-2 text-xs border rounded bg-background text-foreground"
              >
                <option value="">— Select —</option>
                {deals.map(d => (
                  <option key={d.id} value={d.id}>{d.title}</option>
                ))}
              </select>
            </div>
            <div>
              <Label className="text-xs">{t('amount')}</Label>
              <Input type="number" value={formAmount} onChange={e => setFormAmount(e.target.value)} className="text-xs" />
            </div>
            <div>
              <Label className="text-xs">{t('notes')}</Label>
              <Input value={formNotes} onChange={e => setFormNotes(e.target.value)} className="text-xs" placeholder={t('noteOptional')} />
            </div>
            <Button size="sm" onClick={handleSubmit} disabled={submitSettlement.isPending}>
              {t('submitForApproval')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}