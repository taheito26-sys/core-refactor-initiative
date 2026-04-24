import { useTheme } from '@/lib/theme-context';
import { useTrackerState } from '@/lib/useTrackerState';
import { CashManagement } from '@/features/stock/components/CashManagement';
import { useIsMobile } from '@/hooks/use-mobile';
import '@/styles/tracker.css';

interface CashPageProps {
  adminTrackerState?: unknown;
  isAdminView?: boolean;
}

export default function CashPage({ adminTrackerState, isAdminView }: CashPageProps = {}) {
  const { settings } = useTheme();
  const isMobile = useIsMobile();
  const { state, applyState, applyStateAndCommit } = useTrackerState({
    lowStockThreshold: settings.lowStockThreshold,
    priceAlertThreshold: settings.priceAlertThreshold,
    range: settings.range,
    currency: settings.currency,
    preloadedState: adminTrackerState,
    disableCloudSync: Boolean(isAdminView),
  });

  return (
    <div
      className="tracker-root"
      style={isMobile
        ? { padding: 0, width: '100%' }
        : { padding: '12px 16px', maxWidth: 960, margin: '0 auto', width: '100%' }
      }
    >
      <CashManagement state={state} applyState={applyState} applyStateAndCommit={applyStateAndCommit} />
    </div>
  );
}
