// ─── Global Agreements Tab ──────────────────────────────────────────
// Rendered in MerchantsPage's Agreements tab. Shows all agreements
// across relationships and allows creating new ones with a relationship picker.

import { useState } from 'react';
import { useT } from '@/lib/i18n';
import { useAuth } from '@/features/auth/auth-context';
import { isAgreementActive } from '@/lib/deal-engine';
import { AgreementsTab } from './AgreementsTab';
import type { ProfitShareAgreement } from '@/types/domain';

interface Props {
  relationships: any[];
  allAgreements: ProfitShareAgreement[];
  activeAgreementCount: number;
  onOpenRelationship: (id: string) => void;
}

export function AgreementsGlobalTab({ relationships, allAgreements, activeAgreementCount, onOpenRelationship }: Props) {
  const t = useT();
  const { merchantProfile } = useAuth();
  const myMerchantId = merchantProfile?.merchant_id;
  const [createForRelId, setCreateForRelId] = useState<string | null>(null);

  const selectedRel = relationships.find((r: any) => r.id === createForRelId);

  const agreementDisplayLabel = (a: ProfitShareAgreement) => {
    if ((a as any).agreement_type === 'operator_priority') {
      return `⚙️ ${t('operatorPriorityLabel')} · ${(a as any).operator_ratio ?? 0}% ${t('feeLabel')}`;
    }
    return `🤝 ${a.partner_ratio}/${a.merchant_ratio}`;
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

        {/* ── New Agreement: relationship picker ── */}
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

      {/* ── Inline creation form for selected relationship ── */}
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

      {/* Info Banner */}
      <div style={{
        padding: '8px 12px', borderRadius: 6, fontSize: 10, lineHeight: 1.5, marginBottom: 10,
        background: 'color-mix(in srgb, var(--brand) 6%, transparent)',
        border: '1px solid color-mix(in srgb, var(--brand) 15%, transparent)',
        color: 'var(--muted)',
      }}>
        <strong style={{ color: 'var(--brand)' }}>{t('profitShareAgreementsGlobal')}</strong> {t('agreementsCreatedInWorkspace')}
      </div>

      {/* ── Agreements Table ── */}
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
                const statusCls = active ? 'good' : a.status === 'rejected' ? 'bad' : 'warn';
                const statusLabel = active ? t('activeStatus') : a.status === 'rejected' ? t('rejectedStatus') : a.status === 'expired' ? t('expiredStatus') : t('inactiveStatus');
                return (
                  <tr key={a.id} style={{ opacity: active ? 1 : 0.6 }}>
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
                          <>{t('partner')} {a.partner_ratio}% · {t('you')} {a.merchant_ratio}%</>
                        )}
                      </div>
                    </td>
                    <td style={{ fontSize: 10 }}>
                      {a.settlement_cadence === 'per_order' ? t('perOrderCadence') : a.settlement_cadence === 'weekly' ? t('weeklyCadence') : t('monthlyCadence')}
                    </td>
                    <td className="mono" style={{ fontSize: 10 }}>{new Date(a.effective_from).toLocaleDateString()}</td>
                    <td className="mono" style={{ fontSize: 10 }}>{a.expires_at ? new Date(a.expires_at).toLocaleDateString() : '—'}</td>
                    <td><span className={`pill ${statusCls}`}>{statusLabel}</span></td>
                    <td>
                      {rel && (
                        <button className="rowBtn" onClick={() => onOpenRelationship(rel.id)}>
                          {t('openWorkspaceLabel')}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
