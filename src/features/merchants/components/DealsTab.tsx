import { useState, useEffect } from 'react';
import { useT } from '@/lib/i18n';
import { useAuth } from '@/features/auth/auth-context';
import { fmtU } from '@/lib/tracker-helpers';
import { DEAL_TYPE_CONFIGS, SUPPORTED_DEAL_TYPES } from '@/lib/deal-engine';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
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
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [dealType, setDealType] = useState<string>(SUPPORTED_DEAL_TYPES[0]);
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('USDT');
  const [notes, setNotes] = useState('');
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

  const handleCreate = async () => {
    if (!title.trim() || !amount) { toast.error('Title and amount are required'); return; }
    setSubmitting(true);
    try {
      const { error } = await supabase.from('merchant_deals').insert({
        relationship_id: relationshipId,
        title: title.trim(),
        deal_type: dealType,
        amount: parseFloat(amount),
        currency,
        created_by: userId!,
        notes: notes.trim() || null,
      });
      if (error) throw error;
      toast.success(t('dealCreated') || 'Deal created');
      setShowForm(false);
      setTitle(''); setAmount(''); setNotes('');
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700 }}>{t('dealsLabel')}</div>
          <div style={{ fontSize: 10, color: 'var(--muted)' }}>{relDeals.length} {t('activeLabel') || 'active'}</div>
        </div>
        <button className="btn" onClick={() => setShowForm(true)}>+ {t('newDeal')}</button>
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

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm">{t('newDeal')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">{t('title') || 'Title'}</Label>
              <Input value={title} onChange={e => setTitle(e.target.value)} className="text-xs" placeholder="e.g. Partnership Q3" />
            </div>
            <div>
              <Label className="text-xs">{t('type') || 'Type'}</Label>
              <select value={dealType} onChange={e => setDealType(e.target.value)} className="w-full mt-1 p-2 text-xs border rounded bg-background text-foreground">
                {SUPPORTED_DEAL_TYPES.map(dt => {
                  const cfg = DEAL_TYPE_CONFIGS[dt as keyof typeof DEAL_TYPE_CONFIGS];
                  return <option key={dt} value={dt}>{cfg ? `${cfg.icon} ${cfg.label}` : dt}</option>;
                })}
              </select>
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
              <Label className="text-xs">{t('notes')}</Label>
              <Input value={notes} onChange={e => setNotes(e.target.value)} className="text-xs" placeholder={t('noteOptional')} />
            </div>
            <Button size="sm" onClick={handleCreate} disabled={submitting}>
              {t('createDeal') || 'Create Deal'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );


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