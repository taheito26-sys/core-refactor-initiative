import { useState, useEffect } from 'react';
import { useT } from '@/lib/i18n';
import { useAuth } from '@/features/auth/auth-context';
import { fmtU } from '@/lib/tracker-helpers';
import { DEAL_TYPE_CONFIGS, SUPPORTED_DEAL_TYPES } from '@/lib/deal-engine';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { useSubmitCapitalTransfer } from '@/hooks/useCapitalTransfers';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
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

export function DealsTab({ relationshipId, agreements }: Props) {
  const t = useT();
  const { userId } = useAuth();
  const qc = useQueryClient();
  const submitTransfer = useSubmitCapitalTransfer();
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [dealType, setDealType] = useState<string>(SUPPORTED_DEAL_TYPES[0]);
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('USDT');
  const [cadence, setCadence] = useState<string>('monthly');
  const [notes, setNotes] = useState('');
  // Capital Transfer-specific state
  const [transferDirection, setTransferDirection] = useState<'lender_to_operator' | 'operator_to_lender'>('lender_to_operator');
  const [costBasis, setCostBasis] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Realtime for deals
  useEffect(() => {
    if (!relationshipId) return;
    const channel = supabase
      .channel(`deals:${relationshipId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'merchant_deals', filter: `relationship_id=eq.${relationshipId}` }, () => {
        qc.invalidateQueries({ queryKey: ['merchant-deals'] });
        qc.invalidateQueries({ queryKey: ['orders'] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [relationshipId, qc]);

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

  const resetForm = () => {
    setTitle('');
    setDealType(SUPPORTED_DEAL_TYPES[0]);
    setAmount('');
    setCurrency('USDT');
    setCadence('monthly');
    setNotes('');
    setTransferDirection('lender_to_operator');
    setCostBasis('');
  };

  const closeForm = () => {
    setShowForm(false);
    resetForm();
  };

  const handleCreate = async () => {
    setSubmitting(true);
    try {
      if (dealType === 'capital_transfer') {
        if (!amount || !costBasis) { toast.error('Amount and cost basis are required'); return; }
        await submitTransfer.mutateAsync({
          relationship_id: relationshipId,
          direction: transferDirection,
          amount: parseFloat(amount),
          cost_basis: parseFloat(costBasis),
          note: notes.trim() || undefined,
        });
        toast.success(t('dealCreated') || 'Transfer recorded');
        closeForm();
      } else {
        if (!title.trim() || !amount) { toast.error('Title and amount are required'); return; }
        const { error } = await supabase.from('merchant_deals').insert({
          relationship_id: relationshipId,
          title: title.trim(),
          deal_type: dealType,
          amount: parseFloat(amount),
          currency,
          created_by: userId!,
          notes: notes.trim() || null,
          settlement_cadence: cadence,
        } as any);
        if (error) throw error;
        toast.success(t('dealCreated') || 'Deal created');
        closeForm();
      }
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const isCapitalTransfer = dealType === 'capital_transfer';
  const totalCostPreview = amount && costBasis
    ? (parseFloat(amount) * parseFloat(costBasis)).toLocaleString()
    : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700 }}>{t('dealsLabel')}</div>
          <div style={{ fontSize: 10, color: 'var(--muted)' }}>{relDeals.length} {t('activeLabel') || 'active'}</div>
        </div>
        <button className="btn" onClick={() => setShowForm((open) => !open)}>{showForm ? t('close') || 'Close' : `+ ${t('newDeal')}`}</button>
      </div>

      {showForm && (
        <div className="rounded-lg border bg-background p-4 shadow-sm">
          <div className="mb-3">
            <div className="text-sm font-semibold text-foreground">{t('newDeal')}</div>
            <div className="text-xs text-muted-foreground">{t('createDeal') || 'Create Deal'}</div>
          </div>

          <div className="grid gap-3">
            <div>
              <Label className="text-xs">{t('type') || 'Type'}</Label>
              <select value={dealType} onChange={e => setDealType(e.target.value)} className="w-full mt-1 p-2 text-xs border rounded bg-background text-foreground">
                {SUPPORTED_DEAL_TYPES.map(dt => {
                  const cfg = DEAL_TYPE_CONFIGS[dt as keyof typeof DEAL_TYPE_CONFIGS];
                  return <option key={dt} value={dt}>{cfg ? `${cfg.icon} ${cfg.label}` : dt}</option>;
                })}
              </select>
            </div>

            {isCapitalTransfer ? (
              <>
                <div>
                  <Label className="text-xs">{t('direction')}</Label>
                  <select value={transferDirection} onChange={e => setTransferDirection(e.target.value as any)}
                    className="w-full mt-1 p-2 text-xs border rounded bg-background text-foreground">
                    <option value="lender_to_operator">💸 {t('lenderToOperator')}</option>
                    <option value="operator_to_lender">↩️ {t('operatorToLender')}</option>
                  </select>
                </div>
                <div>
                  <Label className="text-xs">{t('amount')} (USDT)</Label>
                  <Input type="number" value={amount} onChange={e => setAmount(e.target.value)} className="text-xs" placeholder="0" />
                </div>
                <div>
                  <Label className="text-xs">{t('costBasisQar')}</Label>
                  <Input type="number" step="0.01" value={costBasis} onChange={e => setCostBasis(e.target.value)} className="text-xs" placeholder="3.65" />
                </div>
                {totalCostPreview && (
                  <div style={{ fontSize: 10, color: 'var(--muted)', padding: '2px 0' }}>
                    {t('totalCostQar')}: <span className="mono" style={{ fontWeight: 700 }}>{totalCostPreview} QAR</span>
                  </div>
                )}
                <div>
                  <Label className="text-xs">{t('noteOptional')}</Label>
                  <Input value={notes} onChange={e => setNotes(e.target.value)} className="text-xs" placeholder={t('noteOptional')} />
                </div>
              </>
            ) : (
              <>
                <div>
                  <Label className="text-xs">{t('title') || 'Title'}</Label>
                  <Input value={title} onChange={e => setTitle(e.target.value)} className="text-xs" placeholder="e.g. Partnership Q3" />
                </div>
                <div>
                  <Label className="text-xs">{t('amount')}</Label>
                  <Input type="number" value={amount} onChange={e => setAmount(e.target.value)} className="text-xs" />
                </div>
                <div>
                  <Label className="text-xs">{t('currency') || 'Currency'}</Label>
                  <select value={currency} onChange={e => setCurrency(e.target.value)} className="w-full mt-1 p-2 text-xs border rounded bg-background text-foreground">
                    <option value="USDT">USDT</option>
                    <option value="USD">USD</option>
                    <option value="IQD">IQD</option>
                  </select>
                </div>
                <div>
                  <Label className="text-xs">{t('settlementCadence')}</Label>
                  <select value={cadence} onChange={e => setCadence(e.target.value)} className="w-full mt-1 p-2 text-xs border rounded bg-background text-foreground">
                    <option value="monthly">📅 {t('monthly')}</option>
                    <option value="weekly">📆 {t('weekly')}</option>
                    <option value="per_order">⚡ {t('perTrade')}</option>
                  </select>
                </div>
                <div>
                  <Label className="text-xs">{t('notes')}</Label>
                  <Input value={notes} onChange={e => setNotes(e.target.value)} className="text-xs" placeholder={t('noteOptional')} />
                </div>
              </>
            )}

            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={handleCreate} disabled={submitting || submitTransfer.isPending}>
                {isCapitalTransfer ? (t('capitalTransfer') || 'Capital Transfer') : (t('createDeal') || 'Create Deal')}
              </Button>
              <Button size="sm" variant="outline" onClick={closeForm} disabled={submitting}>
                {t('cancel') || 'Cancel'}
              </Button>
            </div>
          </div>
        </div>
      )}

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
