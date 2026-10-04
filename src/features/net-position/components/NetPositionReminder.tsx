import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { TrackerState } from '@/lib/tracker-helpers';
import { useT } from '@/lib/i18n';
import { useMonthlySnapshots } from '../api';
import { monthToClose } from '../reminder';

const DISMISS_KEY = 'net_position_reminder_dismissed';

const MONTH_KEYS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'] as const;

function readDismissed(): string {
  try { return localStorage.getItem(DISMISS_KEY) || ''; } catch { return ''; }
}

/** A dashboard nudge, until last month is closed or the merchant dismisses it for that month. */
export function NetPositionReminder({ state }: { state: Pick<TrackerState, 'batches' | 'trades' | 'cashLedger'> }) {
  const t = useT();
  const { snapshots, unavailable, loading } = useMonthlySnapshots();
  const [dismissed, setDismissed] = useState(readDismissed);
  const key = useMemo(() => monthToClose(state, snapshots), [state, snapshots]);
  if (loading || unavailable || !key || dismissed === key) return null;
  const [year, month] = key.split('-').map(Number);
  const label = `${t(MONTH_KEYS[month - 1])} ${year}`;
  return (
    <div role="status" className="panel" style={{ padding: 10, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', borderColor: 'var(--warn)' }}>
      <div style={{ flex: 1, minWidth: 180, fontSize: 12 }}>
        🔒 {t('npReminder').split('{month}').join(label)}
      </div>
      <Link to={`/trading/net-position?month=${key}`} className="btn" style={{ textDecoration: 'none' }}>{t('npReminderOpen')}</Link>
      <button type="button" className="rowBtn" onClick={() => {
        try { localStorage.setItem(DISMISS_KEY, key); } catch { /* per-viewer convenience only */ }
        setDismissed(key);
      }}>{t('npReminderLater')}</button>
    </div>
  );
}
