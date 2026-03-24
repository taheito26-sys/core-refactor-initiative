// ─── Agreements Tab ─────────────────────────────────────────────────
// Manages Profit Share standing agreements for a merchant relationship.
// This is the ONLY place where profit share agreements are created.
// Agreements have 3 statuses: approved, rejected, expired.

import { useState } from 'react';
import { useT } from '@/lib/i18n';
import { useAuth } from '@/features/auth/auth-context';
import { fmtU } from '@/lib/tracker-helpers';
import {
  useProfitShareAgreements,
  useCreateAgreement,
  useUpdateAgreementStatus,
} from '@/hooks/useProfitShareAgreements';
import { isAgreementActive, getAgreementLabel } from '@/lib/deal-engine';
import { toast } from 'sonner';
import '@/styles/tracker.css';

interface Props {
  relationshipId: string;
  counterpartyName?: string;
}

export function AgreementsTab({ relationshipId, counterpartyName }: Props) {
  const t = useT();
  const { userId, merchantProfile } = useAuth();
  const { data: agreements = [], isLoading } = useProfitShareAgreements(relationshipId);
  const createAgreement = useCreateAgreement();
  const updateStatus = useUpdateAgreementStatus();

  const [showForm, setShowForm] = useState(false);
  const [partnerRatio, setPartnerRatio] = useState('50');
  const [cadence, setCadence] = useState<'monthly' | 'weekly' | 'per_order'>('monthly');
  const [effectiveFrom, setEffectiveFrom] = useState(() => new Date().toISOString().slice(0, 10));
  const [expiresAt, setExpiresAt] = useState('');
  const [notes, setNotes] = useState('');

  // Group agreements by status
  const approved = agreements.filter(a => a.status === 'approved' && isAgreementActive(a));
  const expired = agreements.filter(a => a.status === 'expired' || (a.status === 'approved' && !isAgreementActive(a)));
  const rejected = agreements.filter(a => a.status === 'rejected');

  const handleCreate = async () => {
    const ratio = parseFloat(partnerRatio);
    if (isNaN(ratio) || ratio <= 0 || ratio >= 100) {
      toast.error('Partner ratio must be between 1 and 99');
      return;
    }

    try {
      await createAgreement.mutateAsync({
        relationship_id: relationshipId,
        partner_ratio: ratio,
        merchant_ratio: 100 - ratio,
        settlement_cadence: cadence,
        effective_from: new Date(effectiveFrom).toISOString(),
        expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
        notes: notes.trim() || null,
      });
      toast.success('Profit Share agreement created');
      setShowForm(false);
      resetForm();
    } catch (err: any) {
      toast.error(err.message || 'Failed to create agreement');
    }
  };

  const handleReject = async (id: string) => {
    try {
      await updateStatus.mutateAsync({ agreementId: id, status: 'rejected' });
      toast.success('Agreement rejected');
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleExpire = async (id: string) => {
    try {
      await updateStatus.mutateAsync({ agreementId: id, status: 'expired' });
      toast.success('Agreement expired');
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const resetForm = () => {
    setPartnerRatio('50');
    setCadence('monthly');
    setEffectiveFrom(new Date().toISOString().slice(0, 10));
    setExpiresAt('');
    setNotes('');
  };

  const statusPill = (status: string, isActive: boolean) => {
    if (status === 'approved' && isActive) return <span className="pill good">Active</span>;
    if (status === 'approved' && !isActive) return <span className="pill warn">Inactive</span>;
    if (status === 'expired') return <span className="pill warn">Expired</span>;
    if (status === 'rejected') return <span className="pill bad">Rejected</span>;
    return <span className="pill">{status}</span>;
  };

  const cadenceLabel = (c: string) => {
    if (c === 'per_order') return '⚡ Per Order';
    if (c === 'weekly') return '📆 Weekly';
    return '📅 Monthly';
  };

  if (isLoading) {
    return (
      <div className="empty">
        <div className="empty-t">{t('loading') || 'Loading...'}</div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

      {/* ─── Header ─── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700 }}>🤝 Profit Share Agreements</div>
          <div style={{ fontSize: 10, color: 'var(--muted)' }}>
            Standing agreements with {counterpartyName || 'partner'} · {approved.length} active
          </div>
        </div>
        <button className="btn" onClick={() => setShowForm(v => !v)}>
          {showForm ? (t('close') || 'Close') : '+ New Agreement'}
        </button>
      </div>

      {/* ─── Info Banner ─── */}
      <div style={{
        padding: '8px 12px', borderRadius: 6, fontSize: 10, lineHeight: 1.5,
        background: 'color-mix(in srgb, var(--brand) 6%, transparent)',
        border: '1px solid color-mix(in srgb, var(--brand) 15%, transparent)',
        color: 'var(--muted)',
      }}>
        <strong style={{ color: 'var(--brand)' }}>How it works:</strong> Create a Profit Share agreement here.
        Once approved, it becomes available in the <strong>Orders</strong> page when creating profit share orders
        with this merchant. Ratios are locked once agreed — no ad-hoc ratio entry on orders.
      </div>

      {/* ─── Create Form ─── */}
      {showForm && (
        <div style={{
          padding: 14, borderRadius: 8,
          border: '1px solid var(--brand)',
          background: 'color-mix(in srgb, var(--brand) 3%, var(--cardBg))',
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 10 }}>New Profit Share Agreement</div>

          {/* Quick presets */}
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.5px' }}>Quick Presets</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {[30, 40, 50, 60, 70].map(r => (
                <button
                  key={r}
                  className={`pill ${partnerRatio === String(r) ? 'good' : ''}`}
                  style={{ cursor: 'pointer', padding: '4px 10px', fontSize: 10, fontWeight: 700 }}
                  onClick={() => setPartnerRatio(String(r))}
                >
                  {r}/{100 - r}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--muted)', marginBottom: 3 }}>
                Partner Share (%) — {counterpartyName || 'Partner'}
              </div>
              <div className="inputBox" style={{ padding: '6px 10px' }}>
                <input
                  type="number"
                  min="1"
                  max="99"
                  value={partnerRatio}
                  onChange={e => setPartnerRatio(e.target.value)}
                  style={{ fontWeight: 700, color: 'var(--bad)' }}
                />
              </div>
            </div>
            <div>
              <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--muted)', marginBottom: 3 }}>
                Your Share (%) — You
              </div>
              <div className="inputBox" style={{ padding: '6px 10px' }}>
                <input
                  type="number"
                  readOnly
                  value={100 - (parseFloat(partnerRatio) || 0)}
                  style={{ fontWeight: 700, color: 'var(--good)', cursor: 'not-allowed', opacity: 0.7 }}
                />
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--muted)', marginBottom: 3 }}>Settlement Cadence</div>
              <select
                value={cadence}
                onChange={e => setCadence(e.target.value as any)}
                style={{ width: '100%', padding: '6px 8px', fontSize: 10, borderRadius: 4, border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--t1)' }}
              >
                <option value="monthly">📅 Monthly</option>
                <option value="weekly">📆 Weekly</option>
                <option value="per_order">⚡ Per Order</option>
              </select>
            </div>
            <div>
              <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--muted)', marginBottom: 3 }}>Effective From</div>
              <div className="inputBox" style={{ padding: '6px 10px' }}>
                <input type="date" value={effectiveFrom} onChange={e => setEffectiveFrom(e.target.value)} />
              </div>
            </div>
            <div>
              <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--muted)', marginBottom: 3 }}>Expires At (optional)</div>
              <div className="inputBox" style={{ padding: '6px 10px' }}>
                <input type="date" value={expiresAt} onChange={e => setExpiresAt(e.target.value)} />
              </div>
            </div>
          </div>

          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--muted)', marginBottom: 3 }}>Notes (optional)</div>
            <div className="inputBox" style={{ padding: '6px 10px' }}>
              <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional agreement notes..." />
            </div>
          </div>

          {/* Preview */}
          <div style={{
            padding: '8px 12px', borderRadius: 6, marginBottom: 10,
            background: 'color-mix(in srgb, var(--good) 8%, transparent)',
            border: '1px solid color-mix(in srgb, var(--good) 20%, transparent)',
            fontSize: 10,
          }}>
            <strong>Preview:</strong> Profit Share {partnerRatio}/{100 - (parseFloat(partnerRatio) || 0)} —
            {counterpartyName || 'Partner'} gets {partnerRatio}% of net profit, You keep {100 - (parseFloat(partnerRatio) || 0)}%.
            Settlement: {cadenceLabel(cadence)}.
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={handleCreate} disabled={createAgreement.isPending}>
              {createAgreement.isPending ? 'Creating...' : 'Create Agreement'}
            </button>
            <button className="btn secondary" onClick={() => { setShowForm(false); resetForm(); }}>Cancel</button>
          </div>
        </div>
      )}

      {/* ─── Active Agreements ─── */}
      {approved.length > 0 && (
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--good)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.5px' }}>
            ✅ Active Agreements ({approved.length})
          </div>
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>Agreement</th>
                  <th>Cadence</th>
                  <th>Effective</th>
                  <th>Expires</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {approved.map(a => (
                  <tr key={a.id}>
                    <td>
                      <div style={{ fontWeight: 700, fontSize: 11 }}>
                        🤝 {a.partner_ratio}/{a.merchant_ratio}
                      </div>
                      <div style={{ fontSize: 9, color: 'var(--muted)' }}>
                        Partner {a.partner_ratio}% · You {a.merchant_ratio}%
                      </div>
                    </td>
                    <td style={{ fontSize: 10 }}>{cadenceLabel(a.settlement_cadence)}</td>
                    <td className="mono" style={{ fontSize: 10 }}>{new Date(a.effective_from).toLocaleDateString()}</td>
                    <td className="mono" style={{ fontSize: 10 }}>{a.expires_at ? new Date(a.expires_at).toLocaleDateString() : '—'}</td>
                    <td>{statusPill(a.status, isAgreementActive(a))}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button className="rowBtn" style={{ color: 'var(--warn)' }} onClick={() => handleExpire(a.id)}>Expire</button>
                        <button className="rowBtn" style={{ color: 'var(--bad)' }} onClick={() => handleReject(a.id)}>Reject</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ─── Expired Agreements ─── */}
      {expired.length > 0 && (
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--warn)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.5px' }}>
            ⏰ Expired ({expired.length})
          </div>
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>Agreement</th>
                  <th>Cadence</th>
                  <th>Was Effective</th>
                  <th>Expired</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {expired.map(a => (
                  <tr key={a.id} style={{ opacity: 0.7 }}>
                    <td style={{ fontWeight: 700, fontSize: 11 }}>🤝 {a.partner_ratio}/{a.merchant_ratio}</td>
                    <td style={{ fontSize: 10 }}>{cadenceLabel(a.settlement_cadence)}</td>
                    <td className="mono" style={{ fontSize: 10 }}>{new Date(a.effective_from).toLocaleDateString()}</td>
                    <td className="mono" style={{ fontSize: 10 }}>{a.expires_at ? new Date(a.expires_at).toLocaleDateString() : '—'}</td>
                    <td>{statusPill('expired', false)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ─── Rejected Agreements ─── */}
      {rejected.length > 0 && (
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--bad)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.5px' }}>
            ❌ Rejected ({rejected.length})
          </div>
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>Agreement</th>
                  <th>Cadence</th>
                  <th>Created</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rejected.map(a => (
                  <tr key={a.id} style={{ opacity: 0.5 }}>
                    <td style={{ fontWeight: 700, fontSize: 11 }}>🤝 {a.partner_ratio}/{a.merchant_ratio}</td>
                    <td style={{ fontSize: 10 }}>{cadenceLabel(a.settlement_cadence)}</td>
                    <td className="mono" style={{ fontSize: 10 }}>{new Date(a.created_at).toLocaleDateString()}</td>
                    <td>{statusPill('rejected', false)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ─── Empty State ─── */}
      {agreements.length === 0 && !showForm && (
        <div className="empty">
          <div className="empty-t">No agreements yet</div>
          <div className="empty-s">Create a Profit Share agreement to start linking orders with this partner.</div>
        </div>
      )}
    </div>
  );
}
