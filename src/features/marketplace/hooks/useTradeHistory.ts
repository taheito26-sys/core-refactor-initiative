// ─── useTradeHistory — Trade History & CSV Export (Phase 5) ─────────────
import { useMemo, useCallback } from 'react';
import type { OtcTrade } from './useOtcTrades';

interface TradeHistoryFilters {
  dateFrom?: string;
  dateTo?: string;
  status?: string;
  currency?: string;
  counterparty?: string;
}

export function useTradeHistory(trades: OtcTrade[], filters: TradeHistoryFilters) {
  const filtered = useMemo(() => {
    let result = [...trades];
    if (filters.dateFrom) {
      const from = new Date(filters.dateFrom).getTime();
      result = result.filter(t => new Date(t.created_at).getTime() >= from);
    }
    if (filters.dateTo) {
      const to = new Date(filters.dateTo).getTime() + 86400000; // end of day
      result = result.filter(t => new Date(t.created_at).getTime() <= to);
    }
    if (filters.status && filters.status !== 'all') {
      result = result.filter(t => t.status === filters.status);
    }
    if (filters.currency && filters.currency !== 'all') {
      result = result.filter(t => t.currency === filters.currency);
    }
    if (filters.counterparty) {
      const q = filters.counterparty.toLowerCase();
      result = result.filter(t => (t.counterparty_name ?? '').toLowerCase().includes(q));
    }
    return result.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [trades, filters]);

  const exportCSV = useCallback(() => {
    if (filtered.length === 0) return;
    const headers = ['Date', 'Status', 'Side', 'Currency', 'Amount', 'Rate', 'Total', 'Counterparty', 'Note'];
    const rows = filtered.map(t => [
      new Date(t.created_at).toISOString().slice(0, 19).replace('T', ' '),
      t.status,
      t.side,
      t.currency,
      String(t.counter_amount ?? t.amount),
      String(t.counter_rate ?? t.rate),
      String(t.counter_total ?? t.total),
      t.counterparty_name ?? '',
      (t.counter_note ?? t.note ?? '').replace(/"/g, '""'),
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.map(v => `"${v}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `otc-trade-history-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }, [filtered]);

  return { filteredTrades: filtered, exportCSV };
}
