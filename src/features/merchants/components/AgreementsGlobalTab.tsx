// ─── Global Agreements Tab ──────────────────────────────────────────
// Rendered in MerchantsPage's Agreements tab. Shows all agreements
// across relationships and allows creating new ones with a relationship picker.
// Now includes inline View/Edit/Expire/Reject actions matching the workspace.

import React, { useState, useMemo } from 'react';
import { useT } from '@/lib/i18n';
import { useAuth } from '@/features/auth/auth-context';
import { isAgreementActive } from '@/lib/deal-engine';
import { fmtU, getWACOP, fmtQWithUnit } from '@/lib/tracker-helpers';
import { useTrackerState } from '@/lib/useTrackerState';
import { AgreementsTab } from './AgreementsTab';
import { useUpdateAgreementStatus } from '@/hooks/useProfitShareAgreements';
import { calculateOperatorPriorityProfit } from '@/lib/trading/operator-priority';
import { toast } from 'sonner';
import type { ProfitShareAgreement } from '@/types/domain';
import { useTheme } from '@/lib/theme-context';

interface Props {
  relationships: any[];
  allAgreements: ProfitShareAgreement[];
  activeAgreementCount: number;
  onOpenRelationship: (id: string) => void;
}

export function AgreementsGlobalTab({ relationships, allAgreements, activeAgreementCount, onOpenRelationship }: Props) {
  const t = useT();
  const { settings } = useTheme();
  const { userId, merchantProfile } = useAuth();
  const myMerchantId = merchantProfile?.merchant_id;
  const [createForRelId, setCreateForRelId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [simProfit, setSimProfit] = useState<string>('1000');
  const updateStatus = useUpdateAgreementStatus();

  const selectedRel = relationships.find((r: any) => r.id === createForRelId);

  // FIFO avg buy price for QAR↔USDT conversion
  const { derived } = useTrackerState({});
  const avgRate = useMemo(() => getWACOP(derived), [derived]);

  const agreementDisplayLabel = (a: ProfitShareAgreement) => {
    if ((a as any).agreement_type === 'operator_priority') {
      return `⚙️ ${t('operatorPriorityLabel')} · ${(a as any).operator_ratio ?? 0}% ${t('feeLabel')}`;
    }
    return `🤝 ${a.partner_ratio}/${a.merchant_ratio}`;
  };

  const cadenceLabel = (c: string) =>
    c === 'per_order' ? t('perOrderCadence') : c === 'weekly' ? t('weeklyCadence') : t('monthlyCadence');

  const handleExpire = async (id: string) => {
    try {
      await updateStatus.mutateAsync({ agreementId: id, status: 'expired' });
      toast.success(t('agreementExpiredSuccess'));
    } catch (err: any) {
      toast.error(err.message);
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

  // ─── Simulator Panel (mirrors workspace) ──
  const renderSimPanel = (a: any, cpName: string) => {
    const gross = parseFloat(simProfit) || 0;
    const fifoRate = avgRate ?? 0;
    const isOpPriority = a.agreement_type === 'operator_priority';
    const opRatio = a.operator_ratio ?? 0;
    const opContrib = a.operator_contribution ?? 0;
    const lnContrib = a.lender_contribution ?? 0;
    const investedCap = a.invested_capital ?? 0;
    const opDefault = a.operator_default_profit_handling ?? 'reinvest';
    const cpDefault = a.counterparty_default_profit_handling ?? 'withdraw';
    const isOperator = a.operator_merchant_id === myMerchantId;

    let myShare = 0, partnerShare = 0, opFee = 0, remaining = 0;
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
        myShare = result.operatorTotal; partnerShare = result.lenderTotal;
        myPct = result.operatorWeightPct; partnerPct = result.lenderWeightPct;
        myHandling = opDefault; partnerHandling = cpDefault;
      } else {
        myShare = result.lenderTotal; partnerShare = result.operatorTotal;
        myPct = result.lenderWeightPct; partnerPct = result.operatorWeightPct;
        myHandling = cpDefault; partnerHandling = opDefault;
      }
    } else {
      const mRatio = a.merchant_ratio ?? 50;
      const pRatio = a.partner_ratio ?? 50;
      const isCreator = a.created_by === userId;
      myShare = gross * (isCreator ? mRatio : pRatio) / 100;
      partnerShare = gross * (isCreator ? pRatio : mRatio) / 100;
      myPct = isCreator ? mRatio : pRatio;
      partnerPct = isCreator ? pRatio : mRatio;
      remaining = gross;
      const sw = a.settlement_way || 'withdraw';
      myHandling = sw; partnerHandling = sw;
    }

    const myReinvested = myHandling === 'reinvest' ? myShare : 0;
    const myWithdrawn = myHandling === 'withdraw' ? myShare : 0;
    const partnerReinvested = partnerHandling === 'reinvest' ? partnerShare : 0;
    const partnerWithdrawn = partnerHandling === 'withdraw' ? partnerShare : 0;
    const myCurrentCap = isOpPriority ? (isOperator ? opContrib : lnContrib) : investedCap;
    const partnerCurrentCap = isOpPriority ? (isOperator ? lnContrib : opContrib) : investedCap;
    const totalCap = isOpPriority ? opContrib + lnContrib : investedCap;
    const myShareQar = myShare * fifoRate;
    const partnerShareQar = partnerShare * fifoRate;

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
        {/* Agreement Details */}
        <div style={{ ...sectionTitle, marginTop: 0 }}>📋 {t('agreementDetails')}</div>
        <div style={gridStyle}>
          <div><span style={lblStyle}>{t('simType')}</span><br /><span style={valStyle}>{isOpPriority ? 'Operator Priority' : 'Standard'}</span></div>
          <div><span style={lblStyle}>{t('simSettlementCadence')}</span><br /><span style={valStyle}>{cadenceLabel(a.settlement_cadence)}</span></div>
          <div><span style={lblStyle}>{t('simEffectiveFrom')}</span><br /><span style={valStyle}>{new Date(a.effective_from).toLocaleDateString()}</span></div>
          <div><span style={lblStyle}>{t('simInvestedCapital')}</span><br /><span style={valStyle}>{fmtU(totalCap)} USDT</span></div>
          {isOpPriority && (
            <>
              <div><span style={lblStyle}>{t('simOperator')} ({isOperator ? t('you') : cpName})</span><br /><span style={valStyle}>{fmtU(opContrib)} USDT · {opRatio}% {t('fee')}</span></div>
              <div><span style={lblStyle}>{t('simLender')} ({!isOperator ? t('you') : cpName})</span><br /><span style={valStyle}>{fmtU(lnContrib)} USDT</span></div>
            </>
          )}
          <div><span style={lblStyle}>{t('simDefaultHandling')} ({t('you')})</span><br /><span style={valStyle}>{myHandling === 'reinvest' ? `🔄 ${t('reinvestOption')}` : `💰 ${t('withdrawOption')}`}</span></div>
          <div><span style={lblStyle}>{t('simDefaultHandling')} ({cpName})</span><br /><span style={valStyle}>{partnerHandling === 'reinvest' ? `🔄 ${t('reinvestOption')}` : `💰 ${t('withdrawOption')}`}</span></div>
        </div>

        {/* Conversion Info */}
        <div style={sectionTitle}>💱 {t('simConversionRate')}</div>
        <div style={gridStyle}>
          <div><span style={lblStyle}>{t('simFifoRate')}</span><br /><span style={valStyle}>{fifoRate > 0 ? `1 USDT = ${fifoRate.toFixed(4)} QAR` : '—'}</span></div>
          <div><span style={lblStyle}>{t('source')}</span><br /><span style={{ ...valStyle, color: fifoRate > 0 ? 'var(--good)' : 'var(--muted)' }}>{fifoRate > 0 ? 'FIFO Stock Avg Buy' : t('noRateAvailable')}</span></div>
        </div>

        {/* What-If Simulator */}
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
                {fifoRate > 0 && <div style={{ fontSize: 9, color: 'var(--muted)' }}>≈ {Math.round(myShareQar).toLocaleString()} QAR</div>}
                <div style={{ fontSize: 8, color: 'var(--muted)', marginTop: 4 }}>
                  {myHandling === 'reinvest' ? `🔄 ${t('simReinvestedCapital')}: ${fmtU(myReinvested)}` : `💰 ${t('simWithdrawn')}: ${fmtU(myWithdrawn)}`}
                </div>
              </div>
              {/* Partner share */}
              <div style={{ padding: 8, borderRadius: 4, background: 'color-mix(in srgb, var(--brand) 6%, transparent)', border: '1px solid color-mix(in srgb, var(--brand) 15%, transparent)' }}>
                <div style={{ fontSize: 9, color: 'var(--muted)', marginBottom: 2 }}>{cpName} ({partnerPct}%{isOpPriority ? ` ${t('simWeight')}` : ''})</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--brand)' }}>{fmtU(partnerShare)} USDT</div>
                {fifoRate > 0 && <div style={{ fontSize: 9, color: 'var(--muted)' }}>≈ {Math.round(partnerShareQar).toLocaleString()} QAR</div>}
                <div style={{ fontSize: 8, color: 'var(--muted)', marginTop: 4 }}>
                  {partnerHandling === 'reinvest' ? `🔄 ${t('simReinvestedCapital')}: ${fmtU(partnerReinvested)}` : `💰 ${t('simWithdrawn')}: ${fmtU(partnerWithdrawn)}`}
                </div>
              </div>
            </div>

            {/* Capital projection per party */}
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--foreground)', marginBottom: 6 }}>📊 {t('simCapitalProjection')}</div>
              <div style={{ padding: '6px 8px', borderRadius: 4, background: 'color-mix(in srgb, var(--muted) 6%, transparent)', border: '1px solid color-mix(in srgb, var(--muted) 12%, transparent)', marginBottom: 6 }}>
                <div style={{ fontSize: 9, color: 'var(--muted)' }}>{t('simTotalInvestedCapital')}</div>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{fmtU(totalCap)} USDT</div>
                {fifoRate > 0 && <div style={{ fontSize: 9, color: 'var(--muted)' }}>≈ {Math.round(totalCap * fifoRate).toLocaleString()} QAR</div>}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                <div style={{ padding: '6px 8px', borderRadius: 4, background: 'color-mix(in srgb, var(--good) 6%, transparent)', border: '1px solid color-mix(in srgb, var(--good) 12%, transparent)' }}>
                  <div style={{ fontSize: 9, color: 'var(--muted)' }}>{t('you')} — {t('simReinvestedCapital')}</div>
                  <div style={{ fontSize: 9, color: 'var(--muted)', marginTop: 2 }}>{t('simCurrentCapital')}: <strong>{fmtU(myCurrentCap)}</strong></div>
                  <div style={{ fontSize: 9, color: myReinvested > 0 ? 'var(--good)' : 'var(--muted)', marginTop: 1 }}>
                    {myHandling === 'reinvest' ? `🔄 +${fmtU(myReinvested)}` : `💰 ${t('simWithdrawn')}: ${fmtU(myWithdrawn)}`}
                  </div>
                  <div style={{ fontSize: 11, fontWeight: 700, marginTop: 2, color: 'var(--good)' }}>→ {fmtU(myCurrentCap + myReinvested)} USDT</div>
                </div>
                <div style={{ padding: '6px 8px', borderRadius: 4, background: 'color-mix(in srgb, var(--brand) 6%, transparent)', border: '1px solid color-mix(in srgb, var(--brand) 12%, transparent)' }}>
                  <div style={{ fontSize: 9, color: 'var(--muted)' }}>{cpName} — {t('simReinvestedCapital')}</div>
                  <div style={{ fontSize: 9, color: 'var(--muted)', marginTop: 2 }}>{t('simCurrentCapital')}: <strong>{fmtU(partnerCurrentCap)}</strong></div>
                  <div style={{ fontSize: 9, color: partnerReinvested > 0 ? 'var(--brand)' : 'var(--muted)', marginTop: 1 }}>
                    {partnerHandling === 'reinvest' ? `🔄 +${fmtU(partnerReinvested)}` : `💰 ${t('simWithdrawn')}: ${fmtU(partnerWithdrawn)}`}
                  </div>
                  <div style={{ fontSize: 11, fontWeight: 700, marginTop: 2, color: 'var(--brand)' }}>→ {fmtU(partnerCurrentCap + partnerReinvested)} USDT</div>
                </div>
              </div>
              {(myReinvested > 0 || partnerReinvested > 0) && (
                <div style={{ marginTop: 6, padding: '6px 8px', borderRadius: 4, background: 'color-mix(in srgb, var(--warn) 6%, transparent)', border: '1px solid color-mix(in srgb, var(--warn) 15%, transparent)' }}>
                  <div style={{ fontSize: 9, color: 'var(--muted)' }}>{t('simNewCapitalBase')}</div>
                  <div style={{ fontSize: 12, fontWeight: 700 }}>
                    {fmtU(totalCap)} + {fmtU(myReinvested + partnerReinvested)} = <span style={{ color: 'var(--good)' }}>{fmtU(totalCap + myReinvested + partnerReinvested)} USDT</span>
                  </div>
                  {fifoRate > 0 && <div style={{ fontSize: 9, color: 'var(--muted)' }}>≈ {Math.round((totalCap + myReinvested + partnerReinvested) * fifoRate).toLocaleString()} QAR</div>}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700 }}>💛 {t('profitShareAgreements')}</div>
          <div style={{ fontSize: 10, color: 'var(--muted)' }}>
            {t('standingAgreementsAllRels')} · {activeAgreementCount} {t('active')}
          </div>
        </div>

        {!createForRelId ? (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <select
              id="rel-picker"
              style={{
                padding: '6px 10px', fontSize: 10, borderRadius: 4,
                border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--t1)',
                maxWidth: 200,
              }}
              defaultValue=""
              onChange={e => { if (e.target.value) setCreateForRelId(e.target.value); }}
            >
              <option value="" disabled>{t('selectMerchant')}</option>
              {relationships.filter((r: any) => r.status === 'active').map((r: any) => (
                <option key={r.id} value={r.id}>{r.counterparty_name}</option>
              ))}
            </select>
            <span style={{ fontSize: 9, color: 'var(--muted)' }}>← {t('pickToCreateAgreement')}</span>
          </div>
        ) : (
          <button className="btn secondary" onClick={() => setCreateForRelId(null)} style={{ fontSize: 10 }}>
            ✕ {t('close')}
          </button>
        )}
      </div>

      {createForRelId && selectedRel && (
        <div style={{
          marginBottom: 12, padding: 12, borderRadius: 8,
          border: '1px solid var(--brand)',
          background: 'color-mix(in srgb, var(--brand) 3%, var(--cardBg))',
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 8 }}>
            📝 {t('newAgreement')} — {selectedRel.counterparty_name}
          </div>
          <AgreementsTab
            relationshipId={createForRelId}
            counterpartyName={selectedRel.counterparty_name}
            counterpartyMerchantId={
              selectedRel.merchant_a_id === myMerchantId
                ? selectedRel.merchant_b_id
                : selectedRel.merchant_a_id
            }
          />
        </div>
      )}

      <div style={{
        padding: '8px 12px', borderRadius: 6, fontSize: 10, lineHeight: 1.5, marginBottom: 10,
        background: 'color-mix(in srgb, var(--brand) 6%, transparent)',
        border: '1px solid color-mix(in srgb, var(--brand) 15%, transparent)',
        color: 'var(--muted)',
      }}>
        <strong style={{ color: 'var(--brand)' }}>{t('profitShareAgreementsGlobal')}</strong> {t('agreementsCreatedInWorkspace')}
      </div>

      {allAgreements.length === 0 && !createForRelId ? (
        <div className="empty">
          <div className="empty-t">{t('noAgreementsGlobal')}</div>
          <div className="empty-s">{t('selectMerchantAbove')}</div>
        </div>
      ) : allAgreements.length > 0 && (
        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>{t('merchant')}</th>
                <th>{t('agreement')}</th>
                <th>{t('cadence')}</th>
                <th>{t('effective')}</th>
                <th>{t('expires')}</th>
                <th>{t('status')}</th>
                <th>{t('actions')}</th>
              </tr>
            </thead>
            <tbody>
              {allAgreements.map(a => {
                const rel = relationships.find((r: any) => r.id === a.relationship_id);
                const cpName = rel?.counterparty_name || '—';
                const active = a.status === 'approved' && isAgreementActive(a);
                const isPending = a.status === 'pending';
                const isCreator = a.created_by === userId;
                const statusCls = active ? 'good' : isPending ? 'info' : a.status === 'rejected' ? 'bad' : 'warn';
                const statusLabel = active ? t('activeStatus') : isPending ? (t('pendingStatus' as any) || 'Pending') : a.status === 'rejected' ? t('rejectedStatus') : a.status === 'expired' ? t('expiredStatus') : t('inactiveStatus');
                const isExpanded = expandedId === a.id;

                return (
                  <React.Fragment key={a.id}>
                    <tr style={{ opacity: active || isPending ? 1 : 0.6 }}>
                      <td>
                        <div style={{ fontWeight: 700, fontSize: 11 }}>{cpName}</div>
                      </td>
                      <td>
                        <div style={{ fontWeight: 700, fontSize: 11 }}>
                          {agreementDisplayLabel(a)}
                        </div>
                        <div style={{ fontSize: 9, color: 'var(--muted)' }}>
                          {(a as any).agreement_type === 'operator_priority' ? (
                            <>{t('operatorFeeFirst')} {(a as any).operator_ratio}% · {t('thenCapitalSplit')}</>
                          ) : (
                            <>{t('partner')} {a.partner_ratio}% · {t('you')} {a.merchant_ratio}% · {t('capitalLabel')} {fmtQWithUnit((a as any).invested_capital ?? 0, settings.currency, avgRate)} · {(a as any).settlement_way ? ((a as any).settlement_way === 'reinvest' ? t('reinvestOption') : t('withdrawOption')) : '—'}</>
                          )}
                        </div>
                      </td>
                      <td style={{ fontSize: 10 }}>
                        {cadenceLabel(a.settlement_cadence)}
                      </td>
                      <td className="mono" style={{ fontSize: 10 }}>{new Date(a.effective_from).toLocaleDateString()}</td>
                      <td className="mono" style={{ fontSize: 10 }}>{a.expires_at ? new Date(a.expires_at).toLocaleDateString() : '—'}</td>
                      <td><span className={`pill ${statusCls}`}>{statusLabel}</span></td>
                      <td>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          <button className="rowBtn" onClick={() => setExpandedId(isExpanded ? null : a.id)}>{t('viewDetailsAction')}</button>
                          {isPending && !isCreator && (
                            <button className="rowBtn" style={{ color: 'var(--good)', fontWeight: 700 }} onClick={() => handleApprove(a.id)}>{t('approveAction')}</button>
                          )}
                          {isPending && isCreator && rel && (
                            <button className="rowBtn" onClick={() => onOpenRelationship(rel.id)}>{t('editAction')}</button>
                          )}
                          {active && (
                            <button className="rowBtn" style={{ color: 'var(--warn)' }} onClick={() => handleExpire(a.id)}>{t('expireAction')}</button>
                          )}
                          {(active || isPending) && (
                            <button className="rowBtn" style={{ color: 'var(--bad)' }} onClick={() => handleReject(a.id)}>{t('rejectAction')}</button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr><td colSpan={7} style={{ padding: 0 }}>
                        {renderSimPanel(a, cpName)}
                      </td></tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}