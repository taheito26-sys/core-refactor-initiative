// ─── Agreements Tab ─────────────────────────────────────────────────
// Manages Profit Share standing agreements for a merchant relationship.
// This is the ONLY place where profit share agreements are created.
// Agreements have 3 statuses: approved, rejected, expired.
// Supports two agreement types: standard and operator_priority.

import React, { useState, useMemo, useCallback } from 'react';
import { useT } from '@/lib/i18n';
import { useAuth } from '@/features/auth/auth-context';
import { fmtU, getWACOP, fmtQWithUnit } from '@/lib/tracker-helpers';
import { useTrackerState } from '@/lib/useTrackerState';
import {
  useProfitShareAgreements,
  useCreateAgreement,
  useUpdateAgreement,
  useUpdateAgreementStatus,
} from '@/hooks/useProfitShareAgreements';
import { isAgreementActive, getAgreementLabel } from '@/lib/deal-engine';
import { buildOperatorPrioritySnapshot, calculateOperatorPriorityProfit } from '@/lib/trading/operator-priority';
import type { ProfitShareAgreementType } from '@/types/domain';
import { buildSharedProfitShareFields } from '@/lib/profit-share-fields';
import { toast } from 'sonner';
import { useTheme } from '@/lib/theme-context';
import '@/styles/tracker.css';

interface Props {
  relationshipId: string;
  counterpartyName?: string;
  counterpartyMerchantId?: string;
}

export function AgreementsTab({ relationshipId, counterpartyName, counterpartyMerchantId }: Props) {
  const t = useT();
  const { settings } = useTheme();
  const { userId, merchantProfile } = useAuth();
  const { data: agreements = [], isLoading } = useProfitShareAgreements(relationshipId);
  const createAgreement = useCreateAgreement();
  const updateAgreement = useUpdateAgreement();
  const updateStatus = useUpdateAgreementStatus();

  const [showForm, setShowForm] = useState(false);
  const [agreementType, setAgreementType] = useState<ProfitShareAgreementType>('standard');
  const [partnerRatio, setPartnerRatio] = useState('50');
  const [cadence, setCadence] = useState<'monthly' | 'weekly' | 'per_order'>('monthly');
  const [effectiveFrom, setEffectiveFrom] = useState(() => new Date().toISOString().slice(0, 10));
  const [expiresAt, setExpiresAt] = useState('');
  const [notes, setNotes] = useState('');
  const [investedCapital, setInvestedCapital] = useState('');
  const [capitalCurrency, setCapitalCurrency] = useState<'USDT' | 'QAR'>('USDT');
  const [settlementWay, setSettlementWay] = useState<'reinvest' | 'withdraw'>('reinvest');

  // FIFO avg buy price for QAR↔USDT conversion
  const { derived } = useTrackerState({});
  const avgRate = useMemo(() => {
    return getWACOP(derived);
  }, [derived]);

  // Convert invested capital to USDT for storage
  const investedCapitalUsdt = useMemo(() => {
    const raw = parseFloat(investedCapital) || 0;
    if (capitalCurrency === 'USDT') return raw;
    if (!avgRate || avgRate <= 0) return 0;
    return Math.round((raw / avgRate) * 100) / 100;
  }, [investedCapital, capitalCurrency, avgRate]);
  const [editingAgreementId, setEditingAgreementId] = useState<string | null>(null);
  const [expandedAgreementId, setExpandedAgreementId] = useState<string | null>(null);
  const [simProfit, setSimProfit] = useState<string>('1000');

  // ── Operator Priority fields ──
  const [operatorRatio, setOperatorRatio] = useState('20');
  const [operatorIsMe, setOperatorIsMe] = useState(true);
  const [operatorContribution, setOperatorContribution] = useState('');
  const [lenderContribution, setLenderContribution] = useState('');
  // ── Monthly profit handling defaults ──
  const [operatorDefaultHandling, setOperatorDefaultHandling] = useState<'reinvest' | 'withdraw'>('reinvest');
  const [counterpartyDefaultHandling, setCounterpartyDefaultHandling] = useState<'reinvest' | 'withdraw'>('withdraw');

  // Group agreements by status
  const pending = agreements.filter(a => a.status === 'pending');
  const approved = agreements.filter(a => a.status === 'approved' && isAgreementActive(a));
  const expired = agreements.filter(a => a.status === 'expired' || (a.status === 'approved' && !isAgreementActive(a)));
  const rejected = agreements.filter(a => a.status === 'rejected');

  // ─── Simulator Panel ──
  const renderSimulatorPanel = (a: any) => {
    const gross = parseFloat(simProfit) || 0;
    const fifoRate = avgRate;
    const isOpPriority = a.agreement_type === 'operator_priority';
    const opRatio = a.operator_ratio ?? 0;
    const opContrib = a.operator_contribution ?? 0;
    const lnContrib = a.lender_contribution ?? 0;
    const investedCap = (a as any).invested_capital ?? 0;
    const settWay = (a as any).settlement_way;
    const opDefault = a.operator_default_profit_handling ?? 'reinvest';
    const cpDefault = a.counterparty_default_profit_handling ?? 'withdraw';
    const isOperator = a.operator_merchant_id === merchantProfile?.merchant_id;

    let myShare = 0, partnerShare = 0, opFee = 0, remaining = 0;
    let myLabel = t('you'), partnerLabel = counterpartyName || t('partner');
    let myPct = 0, partnerPct = 0;
    let myHandling = '', partnerHandling = '';

    if (isOpPriority) {
      const result = calculateOperatorPriorityProfit({
        grossProfit: gross,
        operatorRatio: opRatio,
        operatorContribution: opContrib,
        lenderContribution: lnContrib,
      });
      opFee = result.operatorFee;
      remaining = result.remainingProfit;
      if (isOperator) {
        myShare = result.operatorTotal;
        partnerShare = result.lenderTotal;
        myPct = result.operatorWeightPct;
        partnerPct = result.lenderWeightPct;
        myHandling = opDefault;
        partnerHandling = cpDefault;
      } else {
        myShare = result.lenderTotal;
        partnerShare = result.operatorTotal;
        myPct = result.lenderWeightPct;
        partnerPct = result.operatorWeightPct;
        myHandling = cpDefault;
        partnerHandling = opDefault;
      }
    } else {
      // Standard split
      const mRatio = a.merchant_ratio ?? 50;
      const pRatio = a.partner_ratio ?? 50;
      const isCreator = a.created_by === userId;
      myShare = gross * (isCreator ? mRatio : pRatio) / 100;
      partnerShare = gross * (isCreator ? pRatio : mRatio) / 100;
      myPct = isCreator ? mRatio : pRatio;
      partnerPct = isCreator ? pRatio : mRatio;
      remaining = gross;
      myHandling = settWay || 'withdraw';
      partnerHandling = settWay || 'withdraw';
    }

    const myReinvested = myHandling === 'reinvest' ? myShare : 0;
    const myWithdrawn = myHandling === 'withdraw' ? myShare : 0;
    const partnerReinvested = partnerHandling === 'reinvest' ? partnerShare : 0;
    const partnerWithdrawn = partnerHandling === 'withdraw' ? partnerShare : 0;
    const newCapitalBase = investedCap + myReinvested + partnerReinvested;

    const qarRate = fifoRate ?? 0;
    const myShareQar = myShare * qarRate;
    const partnerShareQar = partnerShare * qarRate;

    const panelStyle: React.CSSProperties = {
      padding: '12px 16px', background: 'color-mix(in srgb, var(--brand) 4%, var(--surface))',
      border: '1px solid color-mix(in srgb, var(--brand) 15%, transparent)',
      borderRadius: 6, margin: '4px 0 8px',
    };
    const gridStyle: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 16px', fontSize: 10 };
    const lblStyle: React.CSSProperties = { color: 'var(--muted)', fontSize: 9 };
    const valStyle: React.CSSProperties = { fontWeight: 700, fontSize: 11 };
    const sectionTitle: React.CSSProperties = { fontSize: 10, fontWeight: 700, color: 'var(--brand)', marginTop: 10, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.5px' };

    return (
      <div style={panelStyle}>
        {/* ── Agreement Details ── */}
        <div style={{ ...sectionTitle, marginTop: 0 }}>📋 {t('agreementDetails')}</div>
        <div style={gridStyle}>
          <div><span style={lblStyle}>{t('simType')}</span><br /><span style={valStyle}>{isOpPriority ? 'Operator Priority' : 'Standard'}</span></div>
          <div><span style={lblStyle}>{t('simSettlementCadence')}</span><br /><span style={valStyle}>{cadenceLabel(a.settlement_cadence)}</span></div>
          <div><span style={lblStyle}>{t('simEffectiveFrom')}</span><br /><span style={valStyle}>{new Date(a.effective_from).toLocaleDateString()}</span></div>
          <div><span style={lblStyle}>{t('simInvestedCapital')}</span><br /><span style={valStyle}>{fmtU(investedCap)} USDT</span></div>
          {isOpPriority && (
            <>
              <div><span style={lblStyle}>{t('simOperator')} ({a.operator_merchant_id === merchantProfile?.merchant_id ? t('you') : (counterpartyName || t('partner'))})</span><br /><span style={valStyle}>{fmtU(opContrib)} USDT · {opRatio}% {t('fee')}</span></div>
              <div><span style={lblStyle}>{t('simLender')} ({a.operator_merchant_id !== merchantProfile?.merchant_id ? t('you') : (counterpartyName || t('partner'))})</span><br /><span style={valStyle}>{fmtU(lnContrib)} USDT</span></div>
            </>
          )}
          {!isOpPriority && (
            <>
              <div><span style={lblStyle}>{t('simMyShare')}</span><br /><span style={valStyle}>{myPct}%</span></div>
              <div><span style={lblStyle}>{t('simPartnerShare')}</span><br /><span style={valStyle}>{partnerPct}%</span></div>
            </>
          )}
          <div><span style={lblStyle}>{t('simDefaultHandling')} ({t('you')})</span><br /><span style={valStyle}>{myHandling === 'reinvest' ? `🔄 ${t('reinvestOption')}` : `💰 ${t('withdrawOption')}`}</span></div>
          <div><span style={lblStyle}>{t('simDefaultHandling')} ({counterpartyName || t('partner')})</span><br /><span style={valStyle}>{partnerHandling === 'reinvest' ? `🔄 ${t('reinvestOption')}` : `💰 ${t('withdrawOption')}`}</span></div>
        </div>

        {/* ── Conversion Info ── */}
        <div style={sectionTitle}>💱 {t('simConversionRate')}</div>
        <div style={gridStyle}>
          <div><span style={lblStyle}>{t('simFifoRate')}</span><br /><span style={valStyle}>{qarRate > 0 ? `1 USDT = ${qarRate.toFixed(4)} QAR` : '—'}</span></div>
          <div><span style={lblStyle}>{t('source')}</span><br /><span style={{ ...valStyle, color: qarRate > 0 ? 'var(--good)' : 'var(--muted)' }}>{qarRate > 0 ? 'FIFO Stock Avg Buy' : t('noRateAvailable')}</span></div>
        </div>

        {/* ── What-If Simulator ── */}
        <div style={sectionTitle}>🧮 {t('simulatorTitle')}</div>
        <div style={{ marginBottom: 8, fontSize: 9, color: 'var(--muted)' }}>{t('simEnterProfit')}</div>
        <input
          type="number"
          value={simProfit}
          onChange={e => setSimProfit(e.target.value)}
          placeholder="e.g. 9000"
          style={{ width: 160, marginBottom: 8, padding: '4px 8px', borderRadius: 4, border: '1px solid color-mix(in srgb, var(--muted) 30%, transparent)', background: 'var(--surface)', color: 'var(--foreground)', fontSize: 12, fontWeight: 700 }}
        />

        {gross > 0 && (
          <div style={{ background: 'color-mix(in srgb, var(--surface) 80%, transparent)', borderRadius: 6, padding: 10, border: '1px solid color-mix(in srgb, var(--muted) 10%, transparent)' }}>
            {isOpPriority && (
              <div style={{ marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10 }}>
                  <span style={lblStyle}>{t('simOperatorFee')} ({opRatio}%)</span>
                  <span style={{ color: 'var(--warn)', fontWeight: 700 }}>{fmtU(opFee)} USDT</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10 }}>
                  <span style={lblStyle}>{t('simRemainingProfit')}</span>
                  <span style={{ fontWeight: 700 }}>{fmtU(remaining)} USDT</span>
                </div>
                <div style={{ height: 1, background: 'color-mix(in srgb, var(--muted) 15%, transparent)', margin: '6px 0' }} />
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {/* My share */}
              <div style={{ padding: 8, borderRadius: 4, background: 'color-mix(in srgb, var(--good) 6%, transparent)', border: '1px solid color-mix(in srgb, var(--good) 15%, transparent)' }}>
                <div style={{ fontSize: 9, color: 'var(--muted)', marginBottom: 2 }}>{t('simMyShare')} ({myPct}%{isOpPriority ? ` ${t('simWeight')}` : ''})</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--good)' }}>{fmtU(myShare)} USDT</div>
                {qarRate > 0 && <div style={{ fontSize: 9, color: 'var(--muted)' }}>≈ {Math.round(myShareQar).toLocaleString()} QAR</div>}
                <div style={{ fontSize: 8, color: 'var(--muted)', marginTop: 4 }}>
                  {myHandling === 'reinvest' ? `🔄 ${t('simReinvestedCapital')}: ${fmtU(myReinvested)}` : `💰 ${t('simWithdrawn')}: ${fmtU(myWithdrawn)}`}
                </div>
              </div>
              {/* Partner share */}
              <div style={{ padding: 8, borderRadius: 4, background: 'color-mix(in srgb, var(--brand) 6%, transparent)', border: '1px solid color-mix(in srgb, var(--brand) 15%, transparent)' }}>
                <div style={{ fontSize: 9, color: 'var(--muted)', marginBottom: 2 }}>{counterpartyName || t('partner')} ({partnerPct}%{isOpPriority ? ` ${t('simWeight')}` : ''})</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--brand)' }}>{fmtU(partnerShare)} USDT</div>
                {qarRate > 0 && <div style={{ fontSize: 9, color: 'var(--muted)' }}>≈ {Math.round(partnerShareQar).toLocaleString()} QAR</div>}
                <div style={{ fontSize: 8, color: 'var(--muted)', marginTop: 4 }}>
                  {partnerHandling === 'reinvest' ? `🔄 ${t('simReinvestedCapital')}: ${fmtU(partnerReinvested)}` : `💰 ${t('simWithdrawn')}: ${fmtU(partnerWithdrawn)}`}
                </div>
              </div>
            </div>

            {/* Capital projection per party */}
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--foreground)', marginBottom: 6 }}>📊 {t('simCapitalProjection')}</div>

              {/* Total invested capital */}
              <div style={{ padding: '6px 8px', borderRadius: 4, background: 'color-mix(in srgb, var(--muted) 6%, transparent)', border: '1px solid color-mix(in srgb, var(--muted) 12%, transparent)', marginBottom: 6 }}>
                <div style={{ fontSize: 9, color: 'var(--muted)' }}>{t('simTotalInvestedCapital')}</div>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{fmtU(isOpPriority ? opContrib + lnContrib : investedCap)} USDT</div>
                {qarRate > 0 && <div style={{ fontSize: 9, color: 'var(--muted)' }}>≈ {Math.round((isOpPriority ? opContrib + lnContrib : investedCap) * qarRate).toLocaleString()} QAR</div>}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                {/* My capital */}
                <div style={{ padding: '6px 8px', borderRadius: 4, background: 'color-mix(in srgb, var(--good) 6%, transparent)', border: '1px solid color-mix(in srgb, var(--good) 12%, transparent)' }}>
                  <div style={{ fontSize: 9, color: 'var(--muted)' }}>{t('you')} — {t('simReinvestedCapital')}</div>
                  <div style={{ fontSize: 9, color: 'var(--muted)', marginTop: 2 }}>
                    {t('simCurrentCapital')}: <strong>{fmtU(isOpPriority ? (isOperator ? opContrib : lnContrib) : investedCap)}</strong>
                  </div>
                  <div style={{ fontSize: 9, color: myReinvested > 0 ? 'var(--good)' : 'var(--muted)', marginTop: 1 }}>
                    {myHandling === 'reinvest' ? `🔄 +${fmtU(myReinvested)}` : `💰 ${t('simWithdrawn')}: ${fmtU(myWithdrawn)}`}
                  </div>
                  <div style={{ fontSize: 11, fontWeight: 700, marginTop: 2, color: 'var(--good)' }}>
                    → {fmtU((isOpPriority ? (isOperator ? opContrib : lnContrib) : investedCap) + myReinvested)} USDT
                  </div>
                </div>
                {/* Partner capital */}
                <div style={{ padding: '6px 8px', borderRadius: 4, background: 'color-mix(in srgb, var(--brand) 6%, transparent)', border: '1px solid color-mix(in srgb, var(--brand) 12%, transparent)' }}>
                  <div style={{ fontSize: 9, color: 'var(--muted)' }}>{counterpartyName || t('partner')} — {t('simReinvestedCapital')}</div>
                  <div style={{ fontSize: 9, color: 'var(--muted)', marginTop: 2 }}>
                    {t('simCurrentCapital')}: <strong>{fmtU(isOpPriority ? (isOperator ? lnContrib : opContrib) : investedCap)}</strong>
                  </div>
                  <div style={{ fontSize: 9, color: partnerReinvested > 0 ? 'var(--brand)' : 'var(--muted)', marginTop: 1 }}>
                    {partnerHandling === 'reinvest' ? `🔄 +${fmtU(partnerReinvested)}` : `💰 ${t('simWithdrawn')}: ${fmtU(partnerWithdrawn)}`}
                  </div>
                  <div style={{ fontSize: 11, fontWeight: 700, marginTop: 2, color: 'var(--brand)' }}>
                    → {fmtU((isOpPriority ? (isOperator ? lnContrib : opContrib) : investedCap) + partnerReinvested)} USDT
                  </div>
                </div>
              </div>

              {/* New total after reinvestment */}
              {(myReinvested > 0 || partnerReinvested > 0) && (
                <div style={{ marginTop: 6, padding: '6px 8px', borderRadius: 4, background: 'color-mix(in srgb, var(--warn) 6%, transparent)', border: '1px solid color-mix(in srgb, var(--warn) 15%, transparent)' }}>
                  <div style={{ fontSize: 9, color: 'var(--muted)' }}>{t('simNewCapitalBase')}</div>
                  <div style={{ fontSize: 12, fontWeight: 700 }}>
                    {fmtU(isOpPriority ? opContrib + lnContrib : investedCap)} + {fmtU(myReinvested + partnerReinvested)} = <span style={{ color: 'var(--good)' }}>{fmtU((isOpPriority ? opContrib + lnContrib : investedCap) + myReinvested + partnerReinvested)} USDT</span>
                  </div>
                  {qarRate > 0 && <div style={{ fontSize: 9, color: 'var(--muted)' }}>≈ {Math.round(((isOpPriority ? opContrib + lnContrib : investedCap) + myReinvested + partnerReinvested) * qarRate).toLocaleString()} QAR</div>}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  const handleCreate = async () => {
    const ratio = parseFloat(partnerRatio);
    if (agreementType === 'standard') {
      if (isNaN(ratio) || ratio <= 0 || ratio >= 100) {
        toast.error(t('ratioValidation'));
        return;
      }
    }

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
      const sharedFields = buildSharedProfitShareFields({
        agreementType,
        investedCapitalRaw: investedCapital,
        settlementWay,
      });
      const opRatioNum = parseFloat(operatorRatio) || 0;
      const opContribNum = parseFloat(operatorContribution) || 0;
      const lnContribNum = parseFloat(lenderContribution) || 0;

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

      const payloadRatio = agreementType === 'standard' ? ratio : 0;

      const payload = {
        relationship_id: relationshipId,
        partner_ratio: payloadRatio,
        merchant_ratio: agreementType === 'standard' ? 100 - ratio : 0,
        settlement_cadence: cadence,
        invested_capital: agreementType === 'operator_priority'
          ? (opContribNum + lnContribNum)
          : investedCapitalUsdt,
        settlement_way: sharedFields.settlementWay,
        effective_from: new Date(effectiveFrom).toISOString(),
        expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
        notes: notes.trim() || null,
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
      };

      if (editingAgreementId) {
        await updateAgreement.mutateAsync({
          agreementId: editingAgreementId,
          ...payload,
        });
        toast.success(t('agreementUpdatedSuccess'));
      } else {
        await createAgreement.mutateAsync(payload);
        toast.success(t('agreementCreatedSuccess'));
      }

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

  const handleApprove = async (id: string) => {
    try {
      await updateStatus.mutateAsync({ agreementId: id, status: 'approved' });
        toast.success(t('agreementApprovedSuccess'));
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
    setInvestedCapital('');
    setCapitalCurrency('USDT');
    setSettlementWay('reinvest');
    setOperatorRatio('20');
    setOperatorIsMe(true);
    setOperatorContribution('');
    setLenderContribution('');
    setOperatorDefaultHandling('reinvest');
    setCounterpartyDefaultHandling('withdraw');
    setEditingAgreementId(null);
  };

  const handleEditAgreement = (agreement: any) => {
    setEditingAgreementId(agreement.id);
    setAgreementType(agreement.agreement_type ?? 'standard');
    setPartnerRatio(String(agreement.partner_ratio ?? 50));
    setCadence(agreement.settlement_cadence ?? 'monthly');
    setEffectiveFrom(new Date(agreement.effective_from).toISOString().slice(0, 10));
    setExpiresAt(agreement.expires_at ? new Date(agreement.expires_at).toISOString().slice(0, 10) : '');
    setNotes(agreement.notes ?? '');
    setInvestedCapital(agreement.invested_capital != null ? String(agreement.invested_capital) : '');
    setSettlementWay((agreement.settlement_way === 'withdraw' ? 'withdraw' : 'reinvest'));
    setOperatorRatio(String(agreement.operator_ratio ?? 20));
    setOperatorIsMe((agreement.operator_merchant_id ?? merchantProfile?.merchant_id) === merchantProfile?.merchant_id);
    setOperatorContribution(String(agreement.operator_contribution ?? ''));
    setLenderContribution(String(agreement.lender_contribution ?? ''));
    setOperatorDefaultHandling(agreement.operator_default_profit_handling === 'withdraw' ? 'withdraw' : 'reinvest');
    setCounterpartyDefaultHandling(agreement.counterparty_default_profit_handling === 'reinvest' ? 'reinvest' : 'withdraw');
    setShowForm(true);
  };

  const statusPill = (status: string, isActive: boolean) => {
    if (status === 'pending') return <span className="pill info">{t('pendingStatus') || 'Pending'}</span>;
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

      <div style={{
        padding: '8px 12px', borderRadius: 6, fontSize: 10, lineHeight: 1.5,
        background: 'color-mix(in srgb, var(--brand) 6%, transparent)',
        border: '1px solid color-mix(in srgb, var(--brand) 15%, transparent)',
        color: 'var(--muted)',
      }}>
        <strong style={{ color: 'var(--brand)' }}>{t('howItWorksAgreement')}</strong> {t('howItWorksDesc')}
      </div>

      {showForm && (
        <div style={{
          padding: 14, borderRadius: 8,
          border: '1px solid var(--brand)',
          background: 'color-mix(in srgb, var(--brand) 3%, var(--cardBg))',
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 10 }}>
            {editingAgreementId ? t('editAgreementTitle') : t('newProfitShareAgreement')}
          </div>

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

          {agreementType === 'operator_priority' && (
            <div style={{
              padding: 12, borderRadius: 6, marginBottom: 10,
              border: '1px solid color-mix(in srgb, var(--warn) 30%, transparent)',
              background: 'color-mix(in srgb, var(--warn) 4%, transparent)',
            }}>
              <div style={{ fontSize: 10, fontWeight: 700, marginBottom: 8, color: 'var(--warn)' }}>
                ⚙️ {t('operatorPriorityLabel')}
              </div>

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

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--muted)' }}>{t('investedCapitalLabel')}</div>
                <div style={{ display: 'flex', gap: 2 }}>
                  <button
                    className={`pill ${capitalCurrency === 'USDT' ? 'good' : ''}`}
                    style={{ cursor: 'pointer', padding: '2px 6px', fontSize: 8, fontWeight: 700 }}
                    onClick={() => setCapitalCurrency('USDT')}
                  >
                    {t('capitalInUsdt')}
                  </button>
                  <button
                    className={`pill ${capitalCurrency === 'QAR' ? 'good' : ''}`}
                    style={{ cursor: 'pointer', padding: '2px 6px', fontSize: 8, fontWeight: 700 }}
                    onClick={() => setCapitalCurrency('QAR')}
                  >
                    {t('capitalInQar')}
                  </button>
                </div>
              </div>
              <div className="inputBox" style={{ padding: '6px 10px' }}>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={investedCapital}
                  onChange={e => setInvestedCapital(e.target.value)}
                  placeholder="0"
                />
              </div>
              {capitalCurrency === 'QAR' && investedCapital && (
                <div style={{ fontSize: 8, color: 'var(--muted)', marginTop: 2 }}>
                  {avgRate
                    ? `≈ ${fmtU(investedCapitalUsdt)} USDT (${t('convertedFromQar')} ${avgRate.toFixed(2)})`
                    : t('noRateAvailable')}
                </div>
              )}
              {capitalCurrency === 'USDT' && investedCapital && avgRate && (
                <div style={{ fontSize: 8, color: 'var(--muted)', marginTop: 2 }}>
                  {t('convertedFromUsdt')}: {((parseFloat(investedCapital) || 0) * avgRate).toFixed(0)} QAR
                </div>
              )}
            </div>
            <div>
              <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--muted)', marginBottom: 3 }}>{t('settlementWayLabel')}</div>
              <div style={{ display: 'flex', gap: 4 }}>
                <button
                  className={`pill ${settlementWay === 'reinvest' ? 'good' : ''}`}
                  style={{ cursor: 'pointer', padding: '3px 8px', fontSize: 9 }}
                  onClick={() => setSettlementWay('reinvest')}
                >
                  🔄 {t('reinvestOption')}
                </button>
                <button
                  className={`pill ${settlementWay === 'withdraw' ? 'good' : ''}`}
                  style={{ cursor: 'pointer', padding: '3px 8px', fontSize: 9 }}
                  onClick={() => setSettlementWay('withdraw')}
                >
                  💰 {t('withdrawOption')}
                </button>
              </div>
            </div>
          </div>

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
              {' '}{t('investedLabel')}: {fmtU(investedCapitalUsdt)} · {t('settlementWayLabel')}: {settlementWay === 'reinvest' ? t('reinvestOption') : t('withdrawOption')}.
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
                  ④ {t('settlementWayLabel')}: {settlementWay === 'reinvest' ? t('reinvestOption') : t('withdrawOption')}<br />
                  {t('settlement')}: {cadenceLabel(cadence)}.
                </div>
              );
            })()
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={handleCreate} disabled={createAgreement.isPending || updateAgreement.isPending}>
              {createAgreement.isPending || updateAgreement.isPending
                ? (editingAgreementId ? t('savingLabel') : t('creatingAgreement'))
                : (editingAgreementId ? t('saveChangesLabel') : t('createAgreement'))}
            </button>
            <button className="btn secondary" onClick={() => { setShowForm(false); resetForm(); }}>{t('cancel')}</button>
          </div>
        </div>
      )}

      {pending.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--brand)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.5px' }}>
            ⏳ {t('pendingApprovalLabel')} ({pending.length})
          </div>
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>{t('agreement')}</th>
                  <th>{t('cadence')}</th>
                  <th>{t('effective')}</th>
                  <th>{t('proposedByLabel')}</th>
                  <th>{t('actions')}</th>
                </tr>
              </thead>
              <tbody>
                {pending.map(a => {
                  const isCreator = a.created_by === userId;
                  const isExpanded = expandedAgreementId === a.id;
                  return (
                    <React.Fragment key={a.id}>
                    <tr>
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
                              {t('partner')} {a.partner_ratio}% · {t('you')} {a.merchant_ratio}% · {t('capitalLabel')} {fmtQWithUnit((a as any).invested_capital ?? 0, settings.currency, avgRate)} · {(a as any).settlement_way ? ((a as any).settlement_way === 'reinvest' ? t('reinvestOption') : t('withdrawOption')) : '—'}
                            </>
                          )}
                        </div>
                      </td>
                      <td style={{ fontSize: 10 }}>{cadenceLabel(a.settlement_cadence)}</td>
                      <td className="mono" style={{ fontSize: 10 }}>{new Date(a.effective_from).toLocaleDateString()}</td>
                      <td style={{ fontSize: 10 }}>{isCreator ? t('you') : (counterpartyName || t('partner'))}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button className="rowBtn" onClick={() => setExpandedAgreementId(isExpanded ? null : a.id)}>{t('viewDetailsAction')}</button>
                          {!isCreator ? (
                            <>
                              <button className="rowBtn" style={{ color: 'var(--good)', fontWeight: 700 }} onClick={() => handleApprove(a.id)}>{t('approveAction')}</button>
                              <button className="rowBtn" style={{ color: 'var(--bad)' }} onClick={() => handleReject(a.id)}>{t('rejectAction')}</button>
                            </>
                          ) : (
                            <>
                              <button className="rowBtn" onClick={() => handleEditAgreement(a)}>{t('editAction')}</button>
                              <button className="rowBtn" style={{ color: 'var(--bad)' }} onClick={() => handleReject(a.id)}>{t('cancel')}</button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr><td colSpan={5} style={{ padding: 0 }}>
                        {renderSimulatorPanel(a)}
                      </td></tr>
                    )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

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
                {approved.map(a => {
                  const isExpanded = expandedAgreementId === a.id;
                  return (
                    <React.Fragment key={a.id}>
                    <tr>
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
                              {t('partner')} {a.partner_ratio}% · {t('you')} {a.merchant_ratio}% · {t('capitalLabel')} {fmtQWithUnit((a as any).invested_capital ?? 0, settings.currency, avgRate)} · {(a as any).settlement_way ? ((a as any).settlement_way === 'reinvest' ? t('reinvestOption') : t('withdrawOption')) : '—'}
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
                          <button className="rowBtn" onClick={() => setExpandedAgreementId(isExpanded ? null : a.id)}>{t('viewDetailsAction')}</button>
                          <button className="rowBtn" onClick={() => handleEditAgreement(a)}>{t('editAction')}</button>
                          <button className="rowBtn" style={{ color: 'var(--warn)' }} onClick={() => handleExpire(a.id)}>{t('expireAction')}</button>
                          <button className="rowBtn" style={{ color: 'var(--bad)' }} onClick={() => handleReject(a.id)}>{t('rejectAction')}</button>
                        </div>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr><td colSpan={6} style={{ padding: 0 }}>
                        {renderSimulatorPanel(a)}
                      </td></tr>
                    )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

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

      {agreements.length === 0 && !showForm && (
        <div className="empty">
          <div className="empty-t">{t('noAgreementsYet')}</div>
          <div className="empty-s">{t('createAgreementToStart')}</div>
        </div>
      )}
    </div>
  );
}