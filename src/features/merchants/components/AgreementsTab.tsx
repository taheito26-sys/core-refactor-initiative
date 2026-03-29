// ─── Agreements Tab ─────────────────────────────────────────────────
// Manages Profit Share standing agreements for a merchant relationship.
// This is the ONLY place where profit share agreements are created.
// Agreements have 3 statuses: approved, rejected, expired.
// Supports two agreement types: standard and operator_priority.

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
import { buildOperatorPrioritySnapshot } from '@/lib/trading/operator-priority';
import type { ProfitShareAgreementType } from '@/types/domain';
import { toast } from 'sonner';
import '@/styles/tracker.css';

interface Props {
  relationshipId: string;
  counterpartyName?: string;
  counterpartyMerchantId?: string;
}

export function AgreementsTab({ relationshipId, counterpartyName, counterpartyMerchantId }: Props) {
  const t = useT();
  const { userId, merchantProfile } = useAuth();
  const { data: agreements = [], isLoading } = useProfitShareAgreements(relationshipId);
  const createAgreement = useCreateAgreement();
  const updateStatus = useUpdateAgreementStatus();

  const [showForm, setShowForm] = useState(false);
  const [agreementType, setAgreementType] = useState<ProfitShareAgreementType>('standard');
  const [partnerRatio, setPartnerRatio] = useState('50');
  const [cadence, setCadence] = useState<'monthly' | 'weekly' | 'per_order'>('monthly');
  const [effectiveFrom, setEffectiveFrom] = useState(() => new Date().toISOString().slice(0, 10));
  const [expiresAt, setExpiresAt] = useState('');
  const [notes, setNotes] = useState('');

  // ── Operator Priority fields ──
  const [operatorRatio, setOperatorRatio] = useState('20');
  const [operatorIsMe, setOperatorIsMe] = useState(true);
  const [operatorContribution, setOperatorContribution] = useState('');
  const [lenderContribution, setLenderContribution] = useState('');
  // ── Monthly profit handling defaults ──
  const [operatorDefaultHandling, setOperatorDefaultHandling] = useState<'reinvest' | 'withdraw'>('reinvest');
  const [counterpartyDefaultHandling, setCounterpartyDefaultHandling] = useState<'reinvest' | 'withdraw'>('withdraw');

  // Group agreements by status
  const approved = agreements.filter(a => a.status === 'approved' && isAgreementActive(a));
  const expired = agreements.filter(a => a.status === 'expired' || (a.status === 'approved' && !isAgreementActive(a)));
  const rejected = agreements.filter(a => a.status === 'rejected');

  const handleCreate = async () => {
    // Standard type needs valid ratio; operator_priority skips it
    const ratio = parseFloat(partnerRatio);
    if (agreementType === 'standard') {
      if (isNaN(ratio) || ratio <= 0 || ratio >= 100) {
        toast.error(t('ratioValidation'));
        return;
      }
    }

    // ── Operator Priority validation ──
    if (agreementType === 'operator_priority') {
      const opRatio = parseFloat(operatorRatio);
      if (isNaN(opRatio) || opRatio < 0 || opRatio > 100) {
        toast.error(t('operatorRatioRequired'));
        return;
      }
      const opContrib = parseFloat(operatorContribution) || 0;
      const lnContrib = parseFloat(lenderContribution) || 0;
      if (opContrib + lnContrib <= 0) {
        toast.error(t('contributionRequired'));
        return;
      }
    }

    const operatorMerchantId = operatorIsMe
      ? merchantProfile?.merchant_id
      : counterpartyMerchantId;

    try {
      const opRatioNum = parseFloat(operatorRatio) || 0;
      const opContribNum = parseFloat(operatorContribution) || 0;
      const lnContribNum = parseFloat(lenderContribution) || 0;

      // Build terms snapshot for operator priority
      const termsSnapshot = agreementType === 'operator_priority'
        ? buildOperatorPrioritySnapshot({
            operator_merchant_id: operatorMerchantId || '',
            operator_ratio: opRatioNum,
            operator_contribution: opContribNum,
            lender_contribution: lnContribNum,
            partner_ratio: 0,
            merchant_ratio: 0,
            settlement_cadence: cadence,
          }) as unknown as Record<string, unknown>
        : null;

      // For operator_priority, partner_ratio/merchant_ratio are irrelevant — use 0 placeholders
      const payloadRatio = agreementType === 'standard' ? ratio : 0;

      await createAgreement.mutateAsync({
        relationship_id: relationshipId,
        partner_ratio: payloadRatio,
        merchant_ratio: agreementType === 'standard' ? 100 - ratio : 0,
        settlement_cadence: cadence,
        effective_from: new Date(effectiveFrom).toISOString(),
        expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
        notes: notes.trim() || null,
        // Operator priority fields
        agreement_type: agreementType,
        ...(agreementType === 'operator_priority' ? {
          operator_ratio: opRatioNum,
          operator_merchant_id: operatorMerchantId || null,
          operator_contribution: opContribNum,
          lender_contribution: lnContribNum,
          terms_snapshot: termsSnapshot,
          operator_default_profit_handling: operatorDefaultHandling,
          counterparty_default_profit_handling: counterpartyDefaultHandling,
        } : {}),
      });
      toast.success(t('agreementCreatedSuccess'));
      setShowForm(false);
      resetForm();
    } catch (err: any) {
      toast.error(err.message || t('failedToCreate'));
    }
  };

  const handleReject = async (id: string) => {
    try {
      await updateStatus.mutateAsync({ agreementId: id, status: 'rejected' });
      toast.success(t('agreementRejectedSuccess'));
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleExpire = async (id: string) => {
    try {
      await updateStatus.mutateAsync({ agreementId: id, status: 'expired' });
      toast.success(t('agreementExpiredSuccess'));
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const resetForm = () => {
    setAgreementType('standard');
    setPartnerRatio('50');
    setCadence('monthly');
    setEffectiveFrom(new Date().toISOString().slice(0, 10));
    setExpiresAt('');
    setNotes('');
    setOperatorRatio('20');
    setOperatorIsMe(true);
    setOperatorContribution('');
    setLenderContribution('');
    setOperatorDefaultHandling('reinvest');
    setCounterpartyDefaultHandling('withdraw');
  };

  const statusPill = (status: string, isActive: boolean) => {
    if (status === 'approved' && isActive) return <span className="pill good">{t('activeStatus')}</span>;
    if (status === 'approved' && !isActive) return <span className="pill warn">{t('inactiveStatus')}</span>;
    if (status === 'expired') return <span className="pill warn">{t('expiredStatus')}</span>;
    if (status === 'rejected') return <span className="pill bad">{t('rejectedStatus')}</span>;
    return <span className="pill">{status}</span>;
  };

  const cadenceLabel = (c: string) => {
    if (c === 'per_order') return t('perOrderCadence');
    if (c === 'weekly') return t('weeklyCadence');
    return t('monthlyCadence');
  };

  const agreementDisplayLabel = (a: any) => {
    if (a.agreement_type === 'operator_priority') {
      return `⚙️ ${t('operatorPriorityLabel')} · ${a.operator_ratio ?? 0}% ${t('feeLabel')}`;
    }
    return `🤝 ${a.partner_ratio}/${a.merchant_ratio}`;
  };

  if (isLoading) {
    return (
      <div className="empty">
        <div className="empty-t">{t('loading')}</div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

      {/* ─── Header ─── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700 }}>{t('profitShareAgreements')}</div>
          <div style={{ fontSize: 10, color: 'var(--muted)' }}>
            {t('standingAgreementsWith')} {counterpartyName || t('partner')} · {approved.length} {t('active')}
          </div>
        </div>
        <button className="btn" onClick={() => setShowForm(v => !v)}>
          {showForm ? t('close') : `+ ${t('newAgreement')}`}
        </button>
      </div>

      {/* ─── Info Banner ─── */}
      <div style={{
        padding: '8px 12px', borderRadius: 6, fontSize: 10, lineHeight: 1.5,
        background: 'color-mix(in srgb, var(--brand) 6%, transparent)',
        border: '1px solid color-mix(in srgb, var(--brand) 15%, transparent)',
        color: 'var(--muted)',
      }}>
        <strong style={{ color: 'var(--brand)' }}>{t('howItWorksAgreement')}</strong> {t('howItWorksDesc')}
      </div>

      {/* ─── Create Form ─── */}
      {showForm && (
        <div style={{
          padding: 14, borderRadius: 8,
          border: '1px solid var(--brand)',
          background: 'color-mix(in srgb, var(--brand) 3%, var(--cardBg))',
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 10 }}>{t('newProfitShareAgreement')}</div>

          {/* ── Agreement Type Selector ── */}
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.5px' }}>
              {t('agreementTypeLabel')}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                className={`pill ${agreementType === 'standard' ? 'good' : ''}`}
                style={{ cursor: 'pointer', padding: '4px 10px', fontSize: 10, fontWeight: 700 }}
                onClick={() => setAgreementType('standard')}
              >
                🤝 {t('standardProfitShare')}
              </button>
              <button
                className={`pill ${agreementType === 'operator_priority' ? 'good' : ''}`}
                style={{ cursor: 'pointer', padding: '4px 10px', fontSize: 10, fontWeight: 700 }}
                onClick={() => setAgreementType('operator_priority')}
              >
                ⚙️ {t('operatorPriorityLabel')}
              </button>
            </div>
            {agreementType === 'operator_priority' && (
              <div style={{ fontSize: 9, color: 'var(--muted)', marginTop: 4, lineHeight: 1.4 }}>
                {t('operatorPriorityDesc')}
              </div>
            )}
          </div>

          {/* Quick presets (standard only) */}
          {agreementType === 'standard' && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.5px' }}>{t('quickPresets')}</div>
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
          )}

          {/* Standard ratio fields — hidden for operator_priority */}
          {agreementType === 'standard' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--muted)', marginBottom: 3 }}>
                {t('partnerSharePct')} — {counterpartyName || t('partner')}
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
                {t('yourSharePct')} — {t('you')}
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
          )}

          {/* ── Operator Priority Conditional Fields ── */}
          {agreementType === 'operator_priority' && (
            <div style={{
              padding: 12, borderRadius: 6, marginBottom: 10,
              border: '1px solid color-mix(in srgb, var(--warn) 30%, transparent)',
              background: 'color-mix(in srgb, var(--warn) 4%, transparent)',
            }}>
              <div style={{ fontSize: 10, fontWeight: 700, marginBottom: 8, color: 'var(--warn)' }}>
                ⚙️ {t('operatorPriorityLabel')}
              </div>

              {/* Operator merchant selector */}
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--muted)', marginBottom: 3 }}>
                  {t('operatorMerchantLabel')}
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    className={`pill ${operatorIsMe ? 'good' : ''}`}
                    style={{ cursor: 'pointer', padding: '4px 10px', fontSize: 10 }}
                    onClick={() => setOperatorIsMe(true)}
                  >
                    {t('youAreOperator')}
                  </button>
                  <button
                    className={`pill ${!operatorIsMe ? 'good' : ''}`}
                    style={{ cursor: 'pointer', padding: '4px 10px', fontSize: 10 }}
                    onClick={() => setOperatorIsMe(false)}
                  >
                    {t('partnerIsOperator')}
                  </button>
                </div>
              </div>

              {/* Operator fee ratio */}
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--muted)', marginBottom: 3 }}>
                  {t('operatorRatioLabel')}
                </div>
                <div className="inputBox" style={{ padding: '6px 10px' }}>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={operatorRatio}
                    onChange={e => setOperatorRatio(e.target.value)}
                    style={{ fontWeight: 700 }}
                  />
                </div>
                <div style={{ fontSize: 8, color: 'var(--muted)', marginTop: 2 }}>
                  {t('operatorRatioHint')}
                </div>
              </div>

              {/* Capital contributions */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div>
                  <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--muted)', marginBottom: 3 }}>
                    {t('operatorContribLabel')}
                  </div>
                  <div className="inputBox" style={{ padding: '6px 10px' }}>
                    <input
                      type="number"
                      min="0"
                      value={operatorContribution}
                      onChange={e => setOperatorContribution(e.target.value)}
                      placeholder="0"
                      style={{ fontWeight: 700 }}
                    />
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--muted)', marginBottom: 3 }}>
                    {t('lenderContribLabel')}
                  </div>
                  <div className="inputBox" style={{ padding: '6px 10px' }}>
                    <input
                      type="number"
                      min="0"
                      value={lenderContribution}
                      onChange={e => setLenderContribution(e.target.value)}
                      placeholder="0"
                      style={{ fontWeight: 700 }}
                    />
                  </div>
                </div>
              </div>

              {/* Default Monthly Profit Handling */}
              <div style={{ marginTop: 10, padding: 10, borderRadius: 6, border: '1px solid color-mix(in srgb, var(--brand) 20%, transparent)', background: 'color-mix(in srgb, var(--brand) 3%, transparent)' }}>
                <div style={{ fontSize: 10, fontWeight: 700, marginBottom: 6 }}>
                  📅 {t('defaultProfitHandling')}
                </div>
                <div style={{ fontSize: 8, color: 'var(--muted)', marginBottom: 8, lineHeight: 1.4 }}>
                  {t('defaultHandlingHint')}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <div>
                    <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--muted)', marginBottom: 3 }}>
                      {t('operatorDefaultHandling')}
                    </div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button
                        className={`pill ${operatorDefaultHandling === 'reinvest' ? 'good' : ''}`}
                        style={{ cursor: 'pointer', padding: '3px 8px', fontSize: 9 }}
                        onClick={() => setOperatorDefaultHandling('reinvest')}
                      >
                        🔄 {t('reinvestOption')}
                      </button>
                      <button
                        className={`pill ${operatorDefaultHandling === 'withdraw' ? 'good' : ''}`}
                        style={{ cursor: 'pointer', padding: '3px 8px', fontSize: 9 }}
                        onClick={() => setOperatorDefaultHandling('withdraw')}
                      >
                        💰 {t('withdrawOption')}
                      </button>
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--muted)', marginBottom: 3 }}>
                      {t('counterpartyDefaultHandling')}
                    </div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button
                        className={`pill ${counterpartyDefaultHandling === 'reinvest' ? 'good' : ''}`}
                        style={{ cursor: 'pointer', padding: '3px 8px', fontSize: 9 }}
                        onClick={() => setCounterpartyDefaultHandling('reinvest')}
                      >
                        🔄 {t('reinvestOption')}
                      </button>
                      <button
                        className={`pill ${counterpartyDefaultHandling === 'withdraw' ? 'good' : ''}`}
                        style={{ cursor: 'pointer', padding: '3px 8px', fontSize: 9 }}
                        onClick={() => setCounterpartyDefaultHandling('withdraw')}
                      >
                        💰 {t('withdrawOption')}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--muted)', marginBottom: 3 }}>{t('settlementCadence')}</div>
              <select
                value={cadence}
                onChange={e => setCadence(e.target.value as any)}
                style={{ width: '100%', padding: '6px 8px', fontSize: 10, borderRadius: 4, border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--t1)' }}
              >
                <option value="monthly">{t('monthlyCadence')}</option>
                <option value="weekly">{t('weeklyCadence')}</option>
                <option value="per_order">{t('perOrderCadence')}</option>
              </select>
            </div>
            <div>
              <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--muted)', marginBottom: 3 }}>{t('effectiveFrom')}</div>
              <div className="inputBox" style={{ padding: '6px 10px' }}>
                <input type="date" value={effectiveFrom} onChange={e => setEffectiveFrom(e.target.value)} />
              </div>
            </div>
            <div>
              <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--muted)', marginBottom: 3 }}>{t('expiresAtLabel')}</div>
              <div className="inputBox" style={{ padding: '6px 10px' }}>
                <input type="date" value={expiresAt} onChange={e => setExpiresAt(e.target.value)} />
              </div>
            </div>
          </div>

          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--muted)', marginBottom: 3 }}>{t('notesOptionalLabel')}</div>
            <div className="inputBox" style={{ padding: '6px 10px' }}>
              <input value={notes} onChange={e => setNotes(e.target.value)} placeholder={t('optionalAgreementNotes')} />
            </div>
          </div>

          {/* Preview */}
          {agreementType === 'standard' ? (
            <div style={{
              padding: '8px 12px', borderRadius: 6, marginBottom: 10,
              background: 'color-mix(in srgb, var(--good) 8%, transparent)',
              border: '1px solid color-mix(in srgb, var(--good) 20%, transparent)',
              fontSize: 10,
            }}>
              <strong>{t('previewAgreement')}</strong> {t('profitShareLabel')} {partnerRatio}/{100 - (parseFloat(partnerRatio) || 0)} —
              {counterpartyName || t('partner')} {t('gets')} {partnerRatio}% {t('ofNetProfit')}, {t('you')} {t('keeps')} {100 - (parseFloat(partnerRatio) || 0)}%.
              {t('settlement')}: {cadenceLabel(cadence)}.
            </div>
          ) : (
            (() => {
              const opC = parseFloat(operatorContribution) || 0;
              const lnC = parseFloat(lenderContribution) || 0;
              const totalC = opC + lnC;
              const opWt = totalC > 0 ? Math.round((opC / totalC) * 100) : 0;
              const lnWt = totalC > 0 ? Math.round((lnC / totalC) * 100) : 0;
              const operatorName = operatorIsMe ? t('you') : (counterpartyName || t('partner'));
              const lenderName = operatorIsMe ? (counterpartyName || t('partner')) : t('you');
              return (
                <div style={{
                  padding: '8px 12px', borderRadius: 6, marginBottom: 10,
                  background: 'color-mix(in srgb, var(--warn) 8%, transparent)',
                  border: '1px solid color-mix(in srgb, var(--warn) 20%, transparent)',
                  fontSize: 10, lineHeight: 1.6,
                }}>
                  <strong>{t('previewAgreement')}</strong><br />
                  ① {t('operatorFeeFirst')}: {operatorRatio}% → {operatorName}<br />
                  ② {t('thenCapitalSplit')}:<br />
                  &nbsp;&nbsp;{operatorName}: {fmtU(opC)} ({opWt}% {t('weight')})<br />
                  &nbsp;&nbsp;{lenderName}: {fmtU(lnC)} ({lnWt}% {t('weight')})<br />
                  ③ {t('defaultProfitHandling')}:<br />
                  &nbsp;&nbsp;{operatorName}: {operatorDefaultHandling === 'reinvest' ? `🔄 ${t('reinvestOption')}` : `💰 ${t('withdrawOption')}`}<br />
                  &nbsp;&nbsp;{lenderName}: {counterpartyDefaultHandling === 'reinvest' ? `🔄 ${t('reinvestOption')}` : `💰 ${t('withdrawOption')}`}<br />
                  {t('settlement')}: {cadenceLabel(cadence)}.
                </div>
              );
            })()
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={handleCreate} disabled={createAgreement.isPending}>
              {createAgreement.isPending ? t('creatingAgreement') : t('createAgreement')}
            </button>
            <button className="btn secondary" onClick={() => { setShowForm(false); resetForm(); }}>{t('cancel')}</button>
          </div>
        </div>
      )}

      {/* ─── Active Agreements ─── */}
      {approved.length > 0 && (
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--good)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.5px' }}>
            ✅ {t('activeAgreementsLabel')} ({approved.length})
          </div>
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>{t('agreement')}</th>
                  <th>{t('cadence')}</th>
                  <th>{t('effective')}</th>
                  <th>{t('expires')}</th>
                  <th>{t('status')}</th>
                  <th>{t('actions')}</th>
                </tr>
              </thead>
              <tbody>
                {approved.map(a => (
                  <tr key={a.id}>
                    <td>
                      <div style={{ fontWeight: 700, fontSize: 11 }}>
                        {agreementDisplayLabel(a)}
                      </div>
                      <div style={{ fontSize: 9, color: 'var(--muted)' }}>
                        {a.agreement_type === 'operator_priority' ? (
                          <>
                            {t('operatorFeeFirst')} {a.operator_ratio}% · {t('thenCapitalSplit')}
                          </>
                        ) : (
                          <>
                            {t('partner')} {a.partner_ratio}% · {t('you')} {a.merchant_ratio}%
                          </>
                        )}
                      </div>
                    </td>
                    <td style={{ fontSize: 10 }}>{cadenceLabel(a.settlement_cadence)}</td>
                    <td className="mono" style={{ fontSize: 10 }}>{new Date(a.effective_from).toLocaleDateString()}</td>
                    <td className="mono" style={{ fontSize: 10 }}>{a.expires_at ? new Date(a.expires_at).toLocaleDateString() : '—'}</td>
                    <td>{statusPill(a.status, isAgreementActive(a))}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button className="rowBtn" style={{ color: 'var(--warn)' }} onClick={() => handleExpire(a.id)}>{t('expireAction')}</button>
                        <button className="rowBtn" style={{ color: 'var(--bad)' }} onClick={() => handleReject(a.id)}>{t('rejectAction')}</button>
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
            ⏰ {t('expiredAgreementsLabel')} ({expired.length})
          </div>
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>{t('agreement')}</th>
                  <th>{t('cadence')}</th>
                  <th>{t('wasEffective')}</th>
                  <th>{t('expiredStatus')}</th>
                  <th>{t('status')}</th>
                </tr>
              </thead>
              <tbody>
                {expired.map(a => (
                  <tr key={a.id} style={{ opacity: 0.7 }}>
                    <td style={{ fontWeight: 700, fontSize: 11 }}>{agreementDisplayLabel(a)}</td>
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
            ❌ {t('rejectedAgreementsLabel')} ({rejected.length})
          </div>
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>{t('agreement')}</th>
                  <th>{t('cadence')}</th>
                  <th>{t('created')}</th>
                  <th>{t('status')}</th>
                </tr>
              </thead>
              <tbody>
                {rejected.map(a => (
                  <tr key={a.id} style={{ opacity: 0.5 }}>
                    <td style={{ fontWeight: 700, fontSize: 11 }}>{agreementDisplayLabel(a)}</td>
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
          <div className="empty-t">{t('noAgreementsYet')}</div>
          <div className="empty-s">{t('createAgreementToStart')}</div>
        </div>
      )}
    </div>
  );
}
