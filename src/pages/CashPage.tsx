import { useTheme } from '@/lib/theme-context';
import { useTrackerState } from '@/lib/useTrackerState';
import { CashManagement } from '@/features/stock/components/CashManagement';
import { useIsMobile } from '@/hooks/use-mobile';
import { useT } from '@/lib/i18n';
import '@/styles/tracker.css';

interface CashPageProps {
  adminTrackerState?: unknown;
  isAdminView?: boolean;
}

export default function CashPage({ adminTrackerState, isAdminView }: CashPageProps = {}) {
  const { settings } = useTheme();
  const isMobile = useIsMobile();
  const t = useT();
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
      dir={t.isRTL ? 'rtl' : 'ltr'}
      style={{ padding: isMobile ? '6px 0' : 12, display: 'flex', flexDirection: 'column', gap: 8 }}
    >
      <CashManagement state={state} applyState={applyState} applyStateAndCommit={applyStateAndCommit} />
    </div>
  );
}
