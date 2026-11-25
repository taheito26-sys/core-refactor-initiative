import { useState } from 'react';
import { useT } from '@/lib/i18n';
import type { DerivedState, TrackerState } from '@/lib/tracker-helpers';
import { LoansPanel } from './LoansPanel';
import { ConsignmentsPanel } from './ConsignmentsPanel';

/**
 * One page for every USDT movement between merchants: loans, repayments,
 * request approvals, the ledger and the USDT sent to a merchant to sell.
 */
export function UsdtTransfersTab({
  state, derived, applyStateAndCommit, onImportPurchase, initialWorkspace = 'loans',
}: {
  state: TrackerState;
  derived: DerivedState;
  applyStateAndCommit: (next: TrackerState) => Promise<void>;
  onImportPurchase: () => void;
  initialWorkspace?: 'loans' | 'consignments';
}) {
  const t = useT();
  const [workspace, setWorkspace] = useState<'loans' | 'consignments'>(initialWorkspace);
  return (
    <div className="th-embed th-panel" dir={t.isRTL ? 'rtl' : 'ltr'}>
      {workspace === 'loans' ? (
        <LoansPanel
          state={state}
          derived={derived}
          applyStateAndCommit={applyStateAndCommit}
          onImportPurchase={onImportPurchase}
          onOpenConsignments={() => setWorkspace('consignments')}
        />
      ) : (
        <div className="ld-consignments-shell">
          <div className="ld-consignments-head">
            <button type="button" className="ld-back" onClick={() => setWorkspace('loans')}>
              <span aria-hidden="true">←</span> {t('loansBackToLoans')}
            </button>
            <span>{t('loansEyebrow')}</span>
          </div>
          <ConsignmentsPanel state={state} derived={derived} applyStateAndCommit={applyStateAndCommit} />
        </div>
      )}
    </div>
  );
}
