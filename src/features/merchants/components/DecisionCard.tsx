// ─── Settlement Decision Card ───────────────────────────────────────
// Renders monthly profit handling decisions for operator priority periods.
// Shows decision status, allows merchant to choose reinvest/withdraw.

import { useState } from 'react';
import { useT } from '@/lib/i18n';
import { useAuth } from '@/features/auth/auth-context';
import { useSettlementDecisions, useSubmitDecision, type SettlementDecision } from '@/hooks/useSettlementDecisions';
import { fmtU } from '@/lib/tracker-helpers';
import { toast } from 'sonner';
import '@/styles/tracker.css';

interface Props {
  periodId: string;
  periodKey: string;
}

export function DecisionCard({ periodId, periodKey }: Props) {
  const t = useT();
  const { merchantProfile } = useAuth();
  const myMerchantId = merchantProfile?.merchant_id;
  const { data: decisions = [], isLoading } = useSettlementDecisions(periodId);
  const submitDecision = useSubmitDecision();

  if (isLoading || decisions.length === 0) return null;

  return (
    <div style={{
      padding: 10, borderRadius: 6, marginTop: 6,
      border: '1px solid color-mix(in srgb, var(--brand) 20%, transparent)',
      background: 'color-mix(in srgb, var(--brand) 3%, transparent)',
    }}>
      <div style={{ fontSize: 10, fontWeight: 700, marginBottom: 6 }}>
        📅 {t('monthlyDecisionRequired')} · {periodKey}
      </div>
      {decisions.map(d => (
        <DecisionRow
          key={d.id}
          decision={d}
          isMe={d.merchant_id === myMerchantId}
          onSubmit={async (choice) => {
            try {
              await submitDecision.mutateAsync({
                decisionId: d.id,
                decision: choice,
                periodId,
              });
              toast.success(t('decisionSaved'));
            } catch (err: any) {
              toast.error(err.message);
            }
          }}
          isPending={submitDecision.isPending}
        />
      ))}
    </div>
  );
}

function DecisionRow({ decision, isMe, onSubmit, isPending }: {
  decision: SettlementDecision;
  isMe: boolean;
  onSubmit: (choice: 'reinvest' | 'withdraw') => void;
  isPending: boolean;
}) {
  const t = useT();
  const [selected, setSelected] = useState<'reinvest' | 'withdraw' | null>(null);

  const isFinalized = !!decision.finalized_at;
  const isDecided = decision.decision !== 'pending';
  const roleLabel = decision.role === 'operator' ? '⚙️ Operator' : '🏦 Lender';

  return (
    <div style={{
      padding: 8, borderRadius: 4, marginBottom: 4,
      background: isMe ? 'color-mix(in srgb, var(--brand) 6%, transparent)' : 'transparent',
      border: isMe ? '1px solid color-mix(in srgb, var(--brand) 15%, transparent)' : '1px solid var(--line)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <div style={{ fontSize: 10, fontWeight: 700 }}>
          {roleLabel} {isMe && <span style={{ color: 'var(--brand)' }}>({t('you')})</span>}
        </div>
        <div className="mono" style={{ fontSize: 11, fontWeight: 700 }}>
          {fmtU(decision.profit_amount)}
        </div>
      </div>

      {/* Decision state */}
      {isFinalized ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 10 }}>
          <span className={`pill ${decision.decision === 'reinvest' ? 'good' : 'warn'}`}>
            {decision.decision === 'reinvest' ? `🔄 ${t('reinvestOption')}` : `💰 ${t('withdrawOption')}`}
          </span>
          {decision.finalization_snapshot && (decision.finalization_snapshot as any).auto_finalized && (
            <span style={{ fontSize: 8, color: 'var(--muted)' }}>({t('autoFinalizedLabel')})</span>
          )}
          <span className="mono" style={{ fontSize: 9, color: 'var(--muted)' }}>
            {t('effectiveCapitalLabel')}: {fmtU(decision.effective_capital_before)} → {fmtU(decision.effective_capital_after)}
          </span>
        </div>
      ) : isDecided ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 10 }}>
          <span className={`pill ${decision.decision === 'reinvest' ? 'good' : 'warn'}`}>
            {decision.decision === 'reinvest' ? `🔄 ${t('reinvestOption')}` : `💰 ${t('withdrawOption')}`}
          </span>
          <span style={{ fontSize: 8, color: 'var(--muted)' }}>{t('decidedLabel')}</span>
        </div>
      ) : isMe ? (
        <div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
            <button
              className={`pill ${selected === 'reinvest' ? 'good' : ''}`}
              style={{ cursor: 'pointer', padding: '3px 8px', fontSize: 9 }}
              onClick={() => setSelected('reinvest')}
            >
              🔄 {t('reinvestOption')}
            </button>
            <button
              className={`pill ${selected === 'withdraw' ? 'good' : ''}`}
              style={{ cursor: 'pointer', padding: '3px 8px', fontSize: 9 }}
              onClick={() => setSelected('withdraw')}
            >
              💰 {t('withdrawOption')}
            </button>
            {selected && (
              <button
                className="btn"
                style={{ fontSize: 9, padding: '3px 10px' }}
                onClick={() => onSubmit(selected)}
                disabled={isPending}
              >
                {t('confirmDecisionBtn')}
              </button>
            )}
          </div>
          {decision.decision_due_at && (
            <div style={{ fontSize: 8, color: 'var(--muted)' }}>
              {t('decisionDueBy')}: {new Date(decision.decision_due_at).toLocaleDateString()}
              {' · '}{t('defaultHandlingHint')}: {decision.default_behavior === 'reinvest' ? t('reinvestOption') : t('withdrawOption')}
            </div>
          )}
        </div>
      ) : (
        <div style={{ fontSize: 9, color: 'var(--muted)' }}>
          {t('pendingDecisionLabel')}
        </div>
      )}
    </div>
  );
}
