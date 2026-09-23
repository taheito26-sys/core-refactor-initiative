import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useT, type TranslationKey } from '@/lib/i18n';
import {
  fmtDate,
  fmtPrice,
  fmtTotal,
  num,
  totalStock,
  uid,
  type DerivedState,
  type TrackerState,
} from '@/lib/tracker-helpers';
import {
  getUsdtTransferBalances,
  isTransferIn,
  taggedExchangeTransferIds,
  type UsdtTransfer,
  type UsdtTransferKind,
} from '@/lib/usdt-transfers';
import { useExchangeTransfers } from '@/features/exchanges/hooks/useExchangeTransfers';
import { useExchangeP2POrders } from '@/features/exchanges/hooks/useExchangeP2POrders';
import { useExchangeOrderLinks, sumLinkedAmount } from '@/features/exchanges/hooks/useExchangeOrderLinks';
import { useBorrowLendCommit } from '../hooks/useBorrowLendCommit';
import { EXCHANGE_LABELS, type ExchangeP2POrder, type ExchangeTransfer } from '@/features/exchanges/types';
import {
  batchUntaggedUSDT,
  isTradeTaggable,
  tagBatch,
  tagExchangeOrder,
  tagExchangeTransfer,
  tagTrade,
  tradeCounterpartyName,
  untagTransfer,
  TagError,
  type TagResult,
} from '../usdt-tagging';

type Direction = 'in' | 'out';

const KIND_META: Record<UsdtTransferKind, { label: TranslationKey; short: TranslationKey; icon: string }> = {
  borrow_in: { label: 'uxferKindBorrowIn', short: 'uxferTagBorrowed', icon: '⬇️' },
  lend_return: { label: 'uxferKindLendReturn', short: 'uxferTagReturned', icon: '↪️' },
  borrow_repay: { label: 'uxferKindBorrowRepay', short: 'uxferTagRepaid', icon: '↩️' },
  lend_out: { label: 'uxferKindLendOut', short: 'uxferTagLent', icon: '⬆️' },
};
const KINDS_BY_DIR: Record<Direction, UsdtTransferKind[]> = {
  in: ['borrow_in', 'lend_return'],
  out: ['borrow_repay', 'lend_out'],
};

/** One line in the Received / Sent list: either a record still to tag, or a movement already tagged. */
type Row =
  | { key: string; ts: number; amount: number; type: 'batch'; id: string; name: string; sub: string; exchange?: string; price?: number; total: number }
  | { key: string; ts: number; amount: number; type: 'trade'; id: string; name: string; sub: string; exchange?: string; locked: boolean }
  | { key: string; ts: number; amount: number; type: 'exchange'; transfer: ExchangeTransfer; name: string; sub: string; exchange: string }
  | { key: string; ts: number; amount: number; type: 'order'; order: ExchangeP2POrder; name: string; sub: string; exchange: string }
  | { key: string; ts: number; amount: number; type: 'tagged'; transfer: UsdtTransfer; sub: string; exchange?: string };

const PAGE = 40;

/** Tag one listed record (whole or `qty` of it) as `kind`, whatever kind of record it is. */
function tagOne(state: TrackerState, row: Row, kind: UsdtTransferKind, name: string, qty: number): TagResult {
  if (row.type === 'batch') return tagBatch(state, row.id, kind as 'borrow_in' | 'lend_return', name, uid(), qty);
  if (row.type === 'trade') return tagTrade(state, row.id, kind as 'borrow_repay' | 'lend_out', name, uid(), qty);
  if (row.type === 'order') return tagExchangeOrder(state, row.order, kind, name, uid(), row.amount, qty);
  if (row.type === 'exchange') return tagExchangeTransfer(state, row.transfer, kind, name, uid());
  throw new TagError('not_found');
}

const nowInput = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

/**
 * USDT borrowed from / lent to other merchants. Instead of typing movements,
 * the merchant browses what is already in the app — stock batches, orders,
 * and Binance/OKX transfers — and tags each one as what it really was. A
 * tagged order stops being a sale and a tagged batch stops being a purchase;
 * computeFIFO then moves the USDT through stock with no revenue or profit
 * and prices borrowed USDT at the cost of the stock bought to repay it.
 */
export function UsdtTransfersPanel({
  state,
  derived,
  applyStateAndCommit,
}: {
  state: TrackerState;
  derived: DerivedState;
  applyStateAndCommit: (next: TrackerState) => Promise<void>;
}) {
  const t = useT();
  const { commit: saveTag, busy } = useBorrowLendCommit(applyStateAndCommit);
  const { data: exchangeTransfers } = useExchangeTransfers();
  const { data: exchangeOrders } = useExchangeP2POrders();
  const { data: linksByOrder } = useExchangeOrderLinks();

  const [direction, setDirection] = useState<Direction>('in');
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [pending, setPending] = useState<{ key: string; kind: UsdtTransferKind; name: string; amount: string } | null>(null);
  const [showManual, setShowManual] = useState(false);
  /** Rows ticked for a bulk tag (e.g. several sends to one lender), keyed by row key. */
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<{ kind: UsdtTransferKind; name: string } | null>(null);

  const transfers = useMemo(() => state.usdtTransfers || [], [state.usdtTransfers]);
  const activeTransfers = useMemo(() => transfers.filter(x => !x.voided), [transfers]);
  const balances = useMemo(
    () => getUsdtTransferBalances(transfers).filter(b => Math.abs(b.owedToThem) > 1e-6 || Math.abs(b.owedToMe) > 1e-6),
    [transfers],
  );

  const nameSuggestions = useMemo(() => {
    const names = new Set<string>();
    for (const x of transfers) if (x.counterpartyName) names.add(x.counterpartyName);
    for (const s of state.suppliers || []) if (s.name) names.add(s.name);
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [transfers, state.suppliers]);

  const inPriceById = useMemo(() => {
    const m = new Map<string, number>();
    for (const b of derived.batches) if (b.isTransfer) m.set(b.id, b.buyPriceQAR);
    return m;
  }, [derived.batches]);

  const unitCostOf = (x: UsdtTransfer): number | null =>
    isTransferIn(x) ? inPriceById.get(x.id) ?? null : derived.transferCalc?.get(x.id)?.unitCost ?? null;

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    const taggedIds = new Set(activeTransfers.map(x => x.id));
    const taggedExchange = taggedExchangeTransferIds(activeTransfers);

    for (const x of activeTransfers) {
      if (isTransferIn(x) !== (direction === 'in')) continue;
      const src = x.source;
      let sub = t('uxferSrcManual');
      let exchange: string | undefined;
      if (src?.type === 'batch') {
        sub = t('uxferSrcBatch');
        const b = state.batches.find(bb => bb.id === src.id);
        if (b && x.amountUSDT < b.initialUSDT - 1e-6) sub += ` · ${t('uxferPartOf')} ${fmtTotal(b.initialUSDT)}`;
        if (b?.importedFrom) exchange = EXCHANGE_LABELS[b.importedFrom];
      } else if (src?.type === 'trade') {
        sub = t('uxferSrcOrder');
        if (src.partial) sub += ` · ${t('uxferPartOfOrder')}`;
        const tr = state.trades.find(tt => tt.id === src.id);
        if (tr?.importedFrom) exchange = EXCHANGE_LABELS[tr.importedFrom];
      } else if (src?.type === 'exchange') {
        sub = t('uxferSrcTransfer');
        exchange = EXCHANGE_LABELS[src.exchange];
      } else if (src?.type === 'exchange_order') {
        sub = `${t('uxferSrcP2P')} #${src.orderNumber}`;
        exchange = EXCHANGE_LABELS[src.exchange];
      }
      out.push({ key: `x:${x.id}`, ts: x.ts, amount: x.amountUSDT, type: 'tagged', transfer: x, sub, exchange });
    }

    if (direction === 'in') {
      for (const b of state.batches) {
        if (taggedIds.has(b.id) || !(b.initialUSDT > 0)) continue;
        const untagged = batchUntaggedUSDT(state, b.id);
        if (untagged <= 1e-6) continue;
        const partly = untagged < b.initialUSDT - 1e-6;
        out.push({
          key: `b:${b.id}`, ts: b.ts, amount: untagged, total: b.initialUSDT, type: 'batch', id: b.id,
          name: b.source || '',
          sub: partly ? `${t('uxferSrcBatch')} · ${t('uxferLeftOf')} ${fmtTotal(b.initialUSDT)}` : t('uxferSrcBatch'),
          price: b.buyPriceQAR,
          exchange: b.importedFrom ? EXCHANGE_LABELS[b.importedFrom] : undefined,
        });
      }
    } else {
      const splitOffByTrade = new Map<string, number>();
      for (const x of activeTransfers) {
        if (x.source?.type === 'trade' && x.source.partial) {
          splitOffByTrade.set(x.source.id, (splitOffByTrade.get(x.source.id) || 0) + x.amountUSDT);
        }
      }
      for (const tr of state.trades) {
        if (tr.voided || taggedIds.has(tr.id) || !(tr.amountUSDT > 0)) continue;
        const splitOff = splitOffByTrade.get(tr.id) || 0;
        const orderSub = `${t('uxferSrcOrder')} @ ${fmtPrice(tr.sellPriceQAR)}`;
        out.push({
          key: `t:${tr.id}`, ts: tr.ts, amount: tr.amountUSDT, type: 'trade', id: tr.id,
          name: tradeCounterpartyName(state, tr, t.lang),
          sub: splitOff > 0 ? `${orderSub} · ${t('uxferLeftOf')} ${fmtTotal(tr.amountUSDT + splitOff)}` : orderSub,
          exchange: tr.importedFrom ? EXCHANGE_LABELS[tr.importedFrom] : undefined,
          locked: !isTradeTaggable(tr),
        });
      }
    }

    // Exchange transfers that are not already represented by a live batch /
    // order row above (never imported, or dismissed as "not an order").
    const liveIds = new Set<string>([
      ...state.batches.map(b => b.id),
      ...state.trades.filter(tr => !tr.voided || tr.usdtTransferKind).map(tr => tr.id),
    ]);
    for (const et of exchangeTransfers || []) {
      if (et.direction !== direction || taggedExchange.has(et.id)) continue;
      if (et.linked_entity_id && liveIds.has(et.linked_entity_id)) continue;
      if (String(et.asset || '').toUpperCase() !== 'USDT') continue;
      out.push({
        key: `e:${et.id}`,
        ts: et.transfer_time ? new Date(et.transfer_time).getTime() : 0,
        amount: Number(et.amount),
        type: 'exchange',
        transfer: et,
        name: et.counterparty || '',
        sub: `${t('uxferSrcTransfer')} · ${et.kind === 'pay' ? 'Pay' : 'Network'}${et.dismissed_at ? ` · ${t('uxferDismissed')}` : ''}`,
        exchange: EXCHANGE_LABELS[et.exchange],
      });
    }

    // P2P orders the exchange inbox still offers — never imported, or only
    // partly — listed with just the amount not yet imported or tagged, so a
    // send left unimported on the Orders page can still be tagged here.
    const orderSide = direction === 'in' ? 'buy' : 'sell';
    const liveEntityIds = new Set<string>([...liveIds, ...activeTransfers.map(x => x.id)]);
    for (const o of exchangeOrders || []) {
      if (o.side !== orderSide || String(o.asset || '').toUpperCase() !== 'USDT') continue;
      const links = (linksByOrder?.get(o.id) ?? []).filter(l => liveEntityIds.has(l.entity_id));
      let linked = sumLinkedAmount(links);
      if (linked <= 1e-6 && o.linked_at && o.linked_entity_id && liveEntityIds.has(o.linked_entity_id)) linked = o.amount;
      const available = Math.max(0, Math.round((Number(o.amount) - linked) * 1e6) / 1e6);
      if (available <= 0.01) continue;
      out.push({
        key: `o:${o.id}`,
        ts: o.order_time ? new Date(o.order_time).getTime() : 0,
        amount: available,
        type: 'order',
        order: o,
        name: o.counterparty || '',
        sub: `${t('uxferSrcP2P')} #${o.order_number} @ ${fmtPrice(o.price)} ${o.fiat}${linked > 1e-6 ? ` · ${t('uxferLeftOf')} ${fmtTotal(o.amount)}` : ''}`,
        exchange: EXCHANGE_LABELS[o.exchange],
      });
    }

    const q = search.trim().toLowerCase();
    return out
      .filter(r => {
        if (!q) return true;
        const name = r.type === 'tagged' ? r.transfer.counterpartyName : r.name;
        return [name, r.sub, r.exchange, fmtTotal(r.amount), fmtDate(r.ts)].join(' ').toLowerCase().includes(q);
      })
      .sort((a, b) => b.ts - a.ts);
  }, [activeTransfers, direction, state, exchangeTransfers, exchangeOrders, linksByOrder, search, t]);

  const commit = async (result: TagResult, okMsg: TranslationKey) => {
    if (await saveTag(result, okMsg)) {
      setPending(null);
      setSelected(new Set());
      setBulk(null);
    }
  };

  const confirmTag = (row: Row) => {
    if (!pending || row.type === 'tagged') return;
    const name = pending.name.trim();
    if (!name) {
      toast.error(t('uxferErrName'));
      return;
    }
    const qty = num(pending.amount, 0);
    if (!(qty > 0) || qty > row.amount + 1e-6) {
      toast.error(`${t('uxferErrPart')} ${fmtTotal(row.amount)}`);
      return;
    }
    try {
      void commit(tagOne(state, row, pending.kind, name, qty), 'uxferRecorded');
    } catch (err) {
      const code = err instanceof TagError ? err.code : null;
      toast.error(
        code === 'merchant_linked' ? t('uxferLockedOrder')
          : code === 'bad_amount' ? `${t('uxferErrPart')} ${fmtTotal(row.amount)}`
            : t('uxferSaveFailed'),
      );
    }
  };

  const selectedRows = rows.filter(r => selected.has(r.key) && r.type !== 'tagged');
  const selectedTotal = selectedRows.reduce((sum, r) => sum + r.amount, 0);
  const toggleSelected = (key: string) =>
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  /** Tag every ticked row, whole, to one merchant in a single save. */
  const confirmBulk = () => {
    if (!bulk || selectedRows.length === 0) return;
    const name = bulk.name.trim();
    if (!name) {
      toast.error(t('uxferErrName'));
      return;
    }
    try {
      let acc: TagResult = { state };
      for (const row of selectedRows) {
        const r = tagOne(acc.state, row, bulk.kind, name, row.amount);
        acc = {
          state: r.state,
          dismiss: [...(acc.dismiss || []), ...(r.dismiss || [])],
          orderLinks: [...(acc.orderLinks || []), ...(r.orderLinks || [])],
        };
      }
      void commit(acc, 'uxferRecorded');
    } catch (err) {
      toast.error(err instanceof TagError && err.code === 'merchant_linked' ? t('uxferLockedOrder') : t('uxferSaveFailed'));
    }
  };

  const undo = (x: UsdtTransfer) => {
    if (!window.confirm(t('uxferUndoConfirm'))) return;
    try {
      void commit(untagTransfer(state, x.id), 'uxferUndone');
    } catch {
      toast.error(t('uxferSaveFailed'));
    }
  };

  const visible = rows.slice(0, limit);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 800 }}>{t('uxferTitle')}</div>
        <div style={{ fontSize: 10, color: 'var(--muted)' }}>{t('uxferHint')}</div>
      </div>

      {balances.length > 0 && (
        <div className="panel" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 12, fontWeight: 800 }}>{t('uxferBalances')}</div>
          {balances.map(b => (
            <div key={b.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 12, fontWeight: 700 }}>{b.counterpartyName}</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {b.owedToThem > 1e-6 && <span className="pill" style={{ fontSize: 10, color: 'var(--bad)' }}>{t('uxferIOwe')} {fmtTotal(b.owedToThem)} USDT</span>}
                {b.owedToMe > 1e-6 && <span className="pill" style={{ fontSize: 10, color: 'var(--good)' }}>{t('uxferOwesMe')} {fmtTotal(b.owedToMe)} USDT</span>}
                {b.owedToThem < -1e-6 && <span className="pill" style={{ fontSize: 10 }}>{t('uxferOwesMe')} {fmtTotal(-b.owedToThem)} USDT</span>}
                {b.owedToMe < -1e-6 && <span className="pill" style={{ fontSize: 10 }}>{t('uxferIOwe')} {fmtTotal(-b.owedToMe)} USDT</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="panel" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div className="modeToggle" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
          <button type="button" className={direction === 'in' ? 'active' : ''} onClick={() => { setDirection('in'); setPending(null); setSelected(new Set()); setBulk(null); setLimit(PAGE); }}>
            ⬇️ {t('uxferReceived')}
          </button>
          <button type="button" className={direction === 'out' ? 'active' : ''} onClick={() => { setDirection('out'); setPending(null); setSelected(new Set()); setBulk(null); setLimit(PAGE); }}>
            ⬆️ {t('uxferSent')}
          </button>
        </div>
        <div style={{ fontSize: 10, color: 'var(--muted)' }}>
          {direction === 'in' ? t('uxferReceivedHint') : t('uxferSentHint')}
        </div>
        <div className="inputBox" style={{ padding: '6px 10px' }}>
          <input placeholder={t('uxferSearch')} value={search} onChange={e => { setSearch(e.target.value); setLimit(PAGE); }} />
        </div>
        <datalist id="uxfer-counterparties">
          {nameSuggestions.map(n => <option key={n} value={n} />)}
        </datalist>

        {selectedRows.length > 0 && (
          <div style={{ position: 'sticky', top: 0, zIndex: 2, background: 'var(--bg)', border: '1px solid var(--brand)', borderRadius: 8, padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 11, fontWeight: 800 }}>
              {selectedRows.length} {t('uxferSelectedCount')} · <span className="mono">{fmtTotal(selectedTotal)} USDT</span>
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              {KINDS_BY_DIR[direction].map(kind => (
                <button
                  key={kind}
                  type="button"
                  className="rowBtn"
                  style={bulk?.kind === kind ? { borderColor: 'var(--brand)', color: 'var(--brand)', fontWeight: 800 } : undefined}
                  onClick={() => setBulk({ kind, name: bulk?.name ?? (selectedRows.find(r => r.type !== 'tagged' && r.name) as { name?: string } | undefined)?.name ?? '' })}
                >
                  {KIND_META[kind].icon} {t(KIND_META[kind].short)}
                </button>
              ))}
              {bulk && (
                <>
                  <div className="inputBox" style={{ flex: 1, minWidth: 140, padding: '4px 8px' }}>
                    <input list="uxfer-counterparties" placeholder={t('uxferCounterparty')} value={bulk.name} onChange={e => setBulk({ ...bulk, name: e.target.value })} />
                  </div>
                  <button className="btn" type="button" disabled={busy} onClick={confirmBulk}>{t('uxferConfirm')}</button>
                </>
              )}
              <button className="btn secondary" type="button" onClick={() => { setSelected(new Set()); setBulk(null); }}>{t('cancel')}</button>
            </div>
          </div>
        )}

        {visible.length === 0 && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{t('uxferEmpty')}</div>}

        {visible.map(row => {
          if (row.type === 'tagged') {
            const x = row.transfer;
            const meta = KIND_META[x.kind];
            const unit = unitCostOf(x);
            return (
              <div key={row.key} style={{ display: 'flex', alignItems: 'center', gap: 8, borderTop: '1px solid var(--line)', paddingTop: 6, background: 'color-mix(in srgb, var(--brand) 6%, transparent)', borderRadius: 6, padding: '6px 8px' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 800 }}>
                    {meta.icon} {t(meta.label)} · {x.counterpartyName}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--muted)' }}>
                    {fmtDate(x.ts)} · {row.sub}{row.exchange ? ` · ${row.exchange}` : ''}
                    {unit ? ` · ${t('uxferCostAt')} ${fmtPrice(unit)}` : ''}
                  </div>
                </div>
                <span className="mono" style={{ fontSize: 12, fontWeight: 800, color: isTransferIn(x) ? 'var(--good)' : 'var(--bad)' }}>
                  {isTransferIn(x) ? '+' : '−'}{fmtTotal(x.amountUSDT)}
                </span>
                <button className="rowBtn" type="button" disabled={busy} onClick={() => undo(x)}>{t('uxferUndo')}</button>
              </div>
            );
          }
          const isPending = pending?.key === row.key;
          const locked = row.type === 'trade' && row.locked;
          return (
            <div key={row.key} style={{ borderTop: '1px solid var(--line)', paddingTop: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {!locked && (
                  <input
                    type="checkbox"
                    aria-label={t('uxferSelect')}
                    checked={selected.has(row.key)}
                    onChange={() => toggleSelected(row.key)}
                    style={{ width: 16, height: 16, flexShrink: 0 }}
                  />
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 700 }}>
                    <span className="mono">{fmtTotal(row.amount)} USDT</span>
                    {row.name ? ` · ${row.name}` : ''}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--muted)' }}>
                    {fmtDate(row.ts)} · {row.sub}
                    {row.type === 'batch' && row.price ? ` @ ${fmtPrice(row.price)}` : ''}
                    {row.exchange ? ` · ${row.exchange}` : ''}
                  </div>
                </div>
                {locked ? (
                  <span style={{ fontSize: 10, color: 'var(--muted)', maxWidth: 140 }}>{t('uxferLockedOrder')}</span>
                ) : (
                  <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                    {KINDS_BY_DIR[direction].map(kind => (
                      <button
                        key={kind}
                        type="button"
                        className="rowBtn"
                        style={isPending && pending?.kind === kind ? { borderColor: 'var(--brand)', color: 'var(--brand)', fontWeight: 800 } : undefined}
                        onClick={() => setPending({
                          key: row.key,
                          kind,
                          name: isPending ? pending!.name : row.name,
                          amount: isPending ? pending!.amount : String(row.amount),
                        })}
                      >
                        {KIND_META[kind].icon} {t(KIND_META[kind].short)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {isPending && row.type !== 'exchange' && (
                <div style={{ fontSize: 10, color: 'var(--muted)' }}>{t('uxferPartHint')}</div>
              )}
              {isPending && row.type === 'exchange' && (
                <div style={{ fontSize: 10, color: 'var(--muted)' }}>{t('uxferSplitExchangeHint')}</div>
              )}
              {isPending && (
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 10, fontWeight: 700 }}>{t(KIND_META[pending!.kind].label)} —</span>
                  <div className="inputBox" style={{ flex: 1, minWidth: 140, padding: '4px 8px' }}>
                    <input
                      list="uxfer-counterparties"
                      placeholder={t('uxferCounterparty')}
                      value={pending!.name}
                      onChange={e => setPending({ ...pending!, name: e.target.value })}
                      autoFocus
                    />
                  </div>
                  <div className="inputBox" style={{ width: 130, padding: '4px 8px' }} title={row.type === 'exchange' ? t('uxferSplitExchangeHint') : undefined}>
                    <input
                      inputMode="decimal"
                      aria-label={t('uxferAmount')}
                      value={pending!.amount}
                      disabled={row.type === 'exchange'}
                      onChange={e => setPending({ ...pending!, amount: e.target.value })}
                    />
                  </div>
                  <span style={{ fontSize: 10, color: 'var(--muted)' }}>/ {fmtTotal(row.amount)} USDT</span>
                  <button className="btn" type="button" disabled={busy} onClick={() => confirmTag(row)}>{t('uxferConfirm')}</button>
                  <button className="btn secondary" type="button" onClick={() => setPending(null)}>{t('cancel')}</button>
                </div>
              )}
            </div>
          );
        })}

        {rows.length > limit && (
          <button className="btn secondary" type="button" onClick={() => setLimit(l => l + PAGE)}>{t('uxferShowMore')}</button>
        )}
      </div>

      <div>
        <button className="rowBtn" type="button" onClick={() => setShowManual(v => !v)}>
          {showManual ? '▾' : '▸'} {t('uxferManualToggle')}
        </button>
      </div>
      {showManual && (
        <ManualTransferForm
          state={state}
          stockNow={totalStock(derived)}
          busy={busy}
          onSubmit={row => commit({ state: { ...state, usdtTransfers: [...transfers, row] } }, 'uxferRecorded')}
        />
      )}
    </div>
  );
}

/** Fallback for a movement with no matching record anywhere in the app. */
function ManualTransferForm({
  stockNow,
  busy,
  onSubmit,
}: {
  state: TrackerState;
  stockNow: number;
  busy: boolean;
  onSubmit: (row: UsdtTransfer) => Promise<void>;
}) {
  const t = useT();
  const [kind, setKind] = useState<UsdtTransferKind>('borrow_repay');
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(nowInput());
  const [error, setError] = useState('');

  const submit = async () => {
    const qty = num(amount, 0);
    if (!name.trim()) return setError(t('uxferErrName'));
    if (!(qty > 0)) return setError(t('uxferErrAmount'));
    if (!isTransferIn({ kind }) && qty > stockNow + 1e-6) return setError(t('uxferErrStock'));
    const ts = new Date(date).getTime();
    const now = Date.now();
    setError('');
    await onSubmit({
      id: uid(),
      ts: Number.isFinite(ts) ? ts : now,
      kind,
      amountUSDT: qty,
      counterpartyName: name.trim(),
      createdAt: now,
      updatedAt: now,
    });
    setAmount('');
  };

  return (
    <div className="panel" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="modeToggle" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 0 }}>
        {(Object.keys(KIND_META) as UsdtTransferKind[]).map(k => (
          <button key={k} type="button" className={kind === k ? 'active' : ''} onClick={() => setKind(k)} style={{ fontSize: 10, padding: '7px 6px' }}>
            {KIND_META[k].icon} {t(KIND_META[k].label)}
          </button>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
        <div className="field2">
          <div className="lbl">{t('uxferCounterparty')}</div>
          <div className="inputBox"><input list="uxfer-counterparties" value={name} onChange={e => setName(e.target.value)} /></div>
        </div>
        <div className="field2">
          <div className="lbl">{t('uxferAmount')}</div>
          <div className="inputBox"><input inputMode="decimal" placeholder="10000" value={amount} onChange={e => setAmount(e.target.value)} /></div>
        </div>
        <div className="field2">
          <div className="lbl">{t('dateTime')}</div>
          <div className="inputBox"><input type="datetime-local" value={date} onChange={e => setDate(e.target.value)} /></div>
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button className="btn" type="button" disabled={busy} onClick={() => { void submit(); }}>{t('uxferSave')}</button>
      </div>
      {error && <div style={{ fontSize: 11, color: 'var(--bad)' }}>⚠ {error}</div>}
    </div>
  );
}
