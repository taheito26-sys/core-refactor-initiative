import { useTheme } from '@/lib/theme-context';
import { useTrackerState } from '@/lib/useTrackerState';
import { CashManagement } from '@/features/stock/components/CashManagement';
import '@/styles/tracker.css';

interface CashPageProps {
  adminTrackerState?: unknown;
  isAdminView?: boolean;
}

export default function CashPage({ adminTrackerState, isAdminView }: CashPageProps = {}) {
  const { settings } = useTheme();
  const { state, applyState, applyStateAndCommit } = useTrackerState({
    lowStockThreshold: settings.lowStockThreshold,
    priceAlertThreshold: settings.priceAlertThreshold,
    range: settings.range,
    currency: settings.currency,
    preloadedState: adminTrackerState,
    disableCloudSync: Boolean(isAdminView),
  });

  return (
    <div className="trackerRoot" style={{ padding: 12, maxWidth: 900, margin: '0 auto' }}>
      <CashManagement state={state} applyState={applyState} applyStateAndCommit={applyStateAndCommit} />
    </div>
  );
}
