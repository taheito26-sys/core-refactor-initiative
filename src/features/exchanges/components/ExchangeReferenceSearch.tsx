import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useT } from '@/lib/i18n';
import { fmtDate, fmtPrice, fmtTotal, type TrackerState } from '@/lib/tracker-helpers';
import { dismissExchangeRecord, lookupExchangeReference, restoreExchangeRecord } from '../api';
import { useExchangeP2POrders } from '../hooks/useExchangeP2POrders';
import { useExchangeTransfers } from '../hooks/useExchangeTransfers';
import { useExchangeOrderLinks } from '../hooks/useExchangeOrderLinks';
import { MIN_REFERENCE_QUERY, normalizeReferenceQuery, searchReferences, type DetailRow, type ExchangeReferenceHit, type ReferenceScope } from '../reference-search';
import { EXCHANGE_LABELS, type ExchangeId } from '../types';

const DetailList = ({ rows }: { rows: DetailRow[] }) => (
  <div style={{ display: 'grid', gridTemplateColumns: 'minmax(90px, max-content) 1fr', gap: '2px 10px', fontSize: 10 }}>
    {rows.map((r, i) => (
      <div key={`${r.label}-${i}`} style={{ display: 'contents' }}>
        <span style={{ color: 'var(--muted)' }}>{r.label}</span>
        <span className="mono" style={{ overflowWrap: 'anywhere' }}>{r.value}</span>
      </div>
    ))}
  </div>
);

/**
 * Find one transaction by its hash, Pay id or P2P order number, whatever
 * state it is in: not yet registered, registered as stock / an order / a
 * merchant loan, or ignored / removed / fixed by hand. When it is not in the
 * synced history at all, it can be looked up on Binance and OKX directly,
 * which saves it into the tracker's exchange history.
 */
export function ExchangeReferenceSearch({
  state,
  onMerchantLoan,
  onManualFix,
  compact,
  scope = 'all',
}: {
  state: TrackerState;
  /** Offered on a record that is still unregistered. */
  onMerchantLoan?: (hit: ExchangeReferenceHit) => void;
  onManualFix?: (hit: ExchangeReferenceHit) => void;
  compact?: boolean;
  /** stock = received USDT and stock batches, orders = sent USDT and sales, all = both (the Loans tab). */
  scope?: ReferenceScope;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [looking, setLooking] = useState(false);
  const [lookedUp, setLookedUp] = useState('');
  const [openKeys, setOpenKeys] = useState<Set<string>>(new Set());
  const toggleOpen = (key: string) => setOpenKeys((prev) => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  const { data: orders } = useExchangeP2POrders({ includeDismissed: true });
  const { data: transfers } = useExchangeTransfers();
  const { data: linksByOrder } = useExchangeOrderLinks();

  const normalized = normalizeReferenceQuery(query);
  const result = useMemo(
    () => searchReferences({ query, orders, transfers, linksByOrder, state, scope }),
    [query, orders, transfers, linksByOrder, state, scope],
  );
  const searchable = normalized.length >= MIN_REFERENCE_QUERY;
  const nothingFound = searchable && result.exchange.length === 0 && result.tracker.length === 0;

  const refresh = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ['exchange-transfers'] }),
    queryClient.invalidateQueries({ queryKey: ['exchange-p2p-orders'] }),
  ]);

  const lookup = async () => {
    setLooking(true);
    try {
      const exchanges: ExchangeId[] = ['binance', 'okx'];
      const outcomes = await Promise.allSettled(exchanges.map((ex) => lookupExchangeReference(ex, query.trim().replace(/^["'`]+|["'`]+$/g, ''))));
      const found = outcomes.reduce((sum, o) => sum + (o.status === 'fulfilled' ? o.value : 0), 0);
      const failures = outcomes.flatMap((o) => (o.status === 'rejected' && !/No (binance|okx) credentials/i.test(String(o.reason?.message ?? o.reason)) ? [String(o.reason?.message ?? o.reason)] : []));
      await refresh();
      setLookedUp(normalized);
      if (found > 0) toast.success(t('refLookupFound'));
      else if (failures.length > 0) toast.error(`${t('refLookupFailed')}: ${failures[0]}`);
      else toast(t('refLookupNone'));
    } finally {
      setLooking(false);
    }
  };

  const act = async (fn: () => Promise<void>, message: string) => {
    try {
      await fn();
      await refresh();
      toast.success(message);
    } catch {
      toast.error(t('mloanSaveFailed'));
    }
  };

  const statusText = (hit: ExchangeReferenceHit) => {
    const s = hit.status;
    if (s.kind === 'pending') return `⏳ ${t('refStatusPending')}`;
    if (s.kind === 'resolved') {
      const reason = s.reason === 'deleted' ? t('mloanReasonRemoved') : s.reason === 'adjusted' ? t('mloanReasonAdjusted') : t('mloanReasonIgnored');
      return `✓ ${reason}${s.note ? ` — ${s.note}` : ''}`;
    }
    const as = s.as === 'batch' ? t('refAsBatch') : s.as === 'trade' ? t('refAsTrade') : s.as === 'loan' ? t('refAsLoan') : t('refAsImported');
    return `✓ ${as}${s.label ? ` · ${s.label}` : ''}`;
  };
  const statusColor = (hit: ExchangeReferenceHit) =>
    hit.status.kind === 'pending' ? 'var(--warn)' : hit.status.kind === 'resolved' ? 'var(--muted)' : 'var(--good)';

  return (
    <div className="panel" style={{ padding: compact ? 8 : 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`🔎 ${t('refSearchPlaceholder')}`}
          autoComplete="off"
          spellCheck={false}
          style={{ flex: 1, minWidth: 0, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--panel2)', color: 'var(--text)', fontSize: 12, fontFamily: 'monospace' }}
        />
        {query && <button type="button" className="rowBtn" onClick={() => { setQuery(''); setLookedUp(''); }}>✕</button>}
      </div>

      {query && !searchable && <div style={{ fontSize: 10, color: 'var(--muted)' }}>{t('refTooShort')}</div>}

      {result.exchange.map((hit) => (
        <div key={hit.key} style={{ borderTop: '1px solid var(--line)', paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
            <div style={{ fontSize: 12, fontWeight: 800 }}>
              {hit.direction === 'out' ? '⬆️' : '⬇️'} {EXCHANGE_LABELS[hit.exchange]}{' '}
              {hit.source === 'order' ? `P2P${hit.price ? ` @ ${fmtPrice(hit.price)} ${hit.fiat ?? ''}` : ''}` : hit.network ? `${t('refNetwork')} ${hit.network}` : t('refTransfer')}
            </div>
            <div className="mono" style={{ fontSize: 13, fontWeight: 800 }}>{hit.direction === 'out' ? '−' : '+'}{fmtTotal(hit.usdt)} USDT</div>
          </div>
          <div className="mono" style={{ fontSize: 10, color: 'var(--muted)', overflowWrap: 'anywhere' }}>{hit.reference}</div>
          <div style={{ fontSize: 10, color: 'var(--muted)', overflowWrap: 'anywhere' }}>
            {hit.ts ? fmtDate(hit.ts) : ''}
            {hit.counterparty ? ` · ${hit.counterparty}` : ''}
            {hit.exchangeStatus ? ` · ${hit.exchangeStatus}` : ''}
          </div>
          <div style={{ fontSize: 11, fontWeight: 700, color: statusColor(hit) }}>{statusText(hit)}</div>
          {hit.linked && (
            <div style={{ padding: 8, borderRadius: 8, border: '1px solid var(--line)', background: 'var(--panel2)', display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', color: 'var(--muted)' }}>
                {hit.linked.kind === 'batch' ? `📦 ${t('refAsBatch')}` : hit.linked.kind === 'trade' ? `🧾 ${t('refAsTrade')}` : `🤝 ${t('refAsLoan')}`}
              </div>
              <DetailList rows={hit.linked.details} />
            </div>
          )}
          {hit.details.length > 0 && (
            <button type="button" className="rowBtn" style={{ alignSelf: 'flex-start', fontSize: 10 }} onClick={() => toggleOpen(hit.key)}>
              {openKeys.has(hit.key) ? '▾' : '▸'} {t('refAllDetails')}
            </button>
          )}
          {openKeys.has(hit.key) && <DetailList rows={[{ label: 'Reference', value: hit.reference }, ...hit.details]} />}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {hit.status.kind === 'resolved' && (
              <button type="button" className="rowBtn" onClick={() => {
                if (hit.status.kind === 'resolved' && hit.status.reason === 'adjusted' && !window.confirm(t('mloanRestoreAdjustedConfirm'))) return;
                void act(() => restoreExchangeRecord({ source: hit.source, id: hit.id }), t('mloanRestored'));
              }}>↩ {t('mloanRestore')}</button>
            )}
            {hit.status.kind === 'pending' && (
              <>
                {onMerchantLoan && <button type="button" className="rowBtn" style={{ borderColor: 'var(--brand)', color: 'var(--brand)', fontWeight: 800 }} onClick={() => onMerchantLoan(hit)}>🤝 {t('mloanItsLoan')}</button>}
                {onManualFix && <button type="button" className="rowBtn" onClick={() => onManualFix(hit)}>🛠️ {t('mloanFixManually')}</button>}
                <button type="button" className="rowBtn" onClick={() => { void act(() => dismissExchangeRecord({ source: hit.source, id: hit.id }, 'ignored'), t('mloanIgnored')); }}>✕ {t('mloanIgnore')}</button>
              </>
            )}
          </div>
        </div>
      ))}

      {searchable && result.tracker.length > 0 && (
        <div style={{ borderTop: '1px solid var(--line)', paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', color: 'var(--muted)' }}>{t('refInTracker')}</div>
          {result.tracker.map((hit) => (
            <div key={hit.key} style={{ fontSize: 11, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div>
                <strong>{hit.kind === 'batch' ? '📦' : hit.kind === 'trade' ? '🧾' : '🤝'} {hit.label}</strong>
                {' · '}<span className="mono">{fmtTotal(hit.amountUSDT)} USDT</span>{' · '}{fmtDate(hit.ts)}
              </div>
              <DetailList rows={hit.details} />
            </div>
          ))}
        </div>
      )}

      {searchable && result.hiddenByScope > 0 && (
        <div style={{ fontSize: 10, color: 'var(--muted)' }}>
          {(scope === 'stock' ? t('refHiddenSent') : t('refHiddenReceived')).split('{count}').join(String(result.hiddenByScope))}
        </div>
      )}

      {nothingFound && (
        <div style={{ borderTop: '1px solid var(--line)', paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>
            {lookedUp === normalized ? t('refNotFoundAnywhere') : t('refNotInHistory')}
          </div>
          <button type="button" className="btn secondary" disabled={looking} style={{ alignSelf: 'flex-start' }} onClick={() => { void lookup(); }}>
            {looking ? t('refLookingUp') : `🔎 ${t('refLookupButton')}`}
          </button>
        </div>
      )}
      {searchable && (result.exchange.length > 0 || result.tracker.length > 0) && lookedUp !== normalized && (
        <button type="button" className="rowBtn" disabled={looking} style={{ alignSelf: 'flex-start', fontSize: 10 }} onClick={() => { void lookup(); }}>
          {looking ? t('refLookingUp') : t('refLookupAgain')}
        </button>
      )}
    </div>
  );
}
