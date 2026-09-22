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
  type UsdtTransfer,
  type UsdtTransferKind,
} from '@/lib/usdt-transfers';

const KINDS: { kind: UsdtTransferKind; label: TranslationKey; icon: string }[] = [
  { kind: 'borrow_in', label: 'uxferKindBorrowIn', icon: '⬇️' },
  { kind: 'borrow_repay', label: 'uxferKindBorrowRepay', icon: '↩️' },
  { kind: 'lend_out', label: 'uxferKindLendOut', icon: '⬆️' },
  { kind: 'lend_return', label: 'uxferKindLendReturn', icon: '↪️' },
];

const kindLabel = (kind: UsdtTransferKind): TranslationKey =>
  KINDS.find(k => k.kind === kind)?.label ?? 'uxferKindBorrowIn';

const nowInput = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

/**
 * Records USDT borrowed from / lent to other merchants. These are not
 * orders: each one moves stock through FIFO (see computeFIFO) with no
 * revenue and no profit, so repaying a lender no longer leaves phantom
 * stock behind to distort the cost of the next real sale.
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
  const [kind, setKind] = useState<UsdtTransferKind>('borrow_repay');
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [refPrice, setRefPrice] = useState('');
  const [date, setDate] = useState(nowInput());
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const transfers = useMemo(() => state.usdtTransfers || [], [state.usdtTransfers]);
  const active = useMemo(
    () => transfers.filter(x => !x.voided).sort((a, b) => b.ts - a.ts),
    [transfers],
  );
  const balances = useMemo(
    () => getUsdtTransferBalances(transfers).filter(b => Math.abs(b.owedToThem) > 1e-6 || Math.abs(b.owedToMe) > 1e-6),
    [transfers],
  );
  const stockNow = totalStock(derived);

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

  const prefill = (nextKind: UsdtTransferKind, counterparty: string, qty: number) => {
    setKind(nextKind);
    setName(counterparty);
    setAmount(String(Math.round(qty * 100) / 100));
    setError('');
  };

  const submit = async () => {
    const qty = num(amount, 0);
    const counterpartyName = name.trim();
    if (!counterpartyName) return setError(t('uxferErrName'));
    if (!(qty > 0)) return setError(t('uxferErrAmount'));
    if (!isTransferIn({ kind }) && qty > stockNow + 1e-6) return setError(t('uxferErrStock'));
    const ts = new Date(date).getTime();
    const now = Date.now();
    const row: UsdtTransfer = {
      id: uid(),
      ts: Number.isFinite(ts) ? ts : now,
      kind,
      amountUSDT: qty,
      counterpartyName,
      note: note.trim() || undefined,
      createdAt: now,
      updatedAt: now,
    };
    if (kind === 'borrow_in' && num(refPrice, 0) > 0) row.refPriceQAR = num(refPrice, 0);
    setSaving(true);
    try {
      await applyStateAndCommit({ ...state, usdtTransfers: [...transfers, row] });
      toast.success(t('uxferRecorded'));
      setAmount('');
      setRefPrice('');
      setNote('');
      setError('');
    } catch (err) {
      console.error('[UsdtTransfersPanel] save failed:', err);
      toast.error(t('uxferSaveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm(t('uxferDeleteConfirm'))) return;
    const now = Date.now();
    try {
      await applyStateAndCommit({
        ...state,
        usdtTransfers: transfers.map(x => (x.id === id ? { ...x, voided: true, updatedAt: now } : x)),
      });
    } catch (err) {
      console.error('[UsdtTransfersPanel] delete failed:', err);
      toast.error(t('uxferSaveFailed'));
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 800 }}>{t('uxferTitle')}</div>
        <div style={{ fontSize: 10, color: 'var(--muted)' }}>{t('uxferHint')}</div>
      </div>

      <div className="panel" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div className="modeToggle" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 0 }}>
          {KINDS.map(k => (
            <button
              key={k.kind}
              type="button"
              className={kind === k.kind ? 'active' : ''}
              onClick={() => { setKind(k.kind); setError(''); }}
              style={{ fontSize: 10, padding: '7px 6px' }}
            >
              {k.icon} {t(k.label)}
            </button>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8 }}>
          <div className="field2">
            <div className="lbl">{t('uxferCounterparty')}</div>
            <div className="inputBox">
              <input list="uxfer-counterparties" value={name} onChange={e => setName(e.target.value)} />
              <datalist id="uxfer-counterparties">
                {nameSuggestions.map(n => <option key={n} value={n} />)}
              </datalist>
            </div>
          </div>
          <div className="field2">
            <div className="lbl">{t('uxferAmount')}</div>
            <div className="inputBox"><input inputMode="decimal" placeholder="10000" value={amount} onChange={e => setAmount(e.target.value)} /></div>
          </div>
          <div className="field2">
            <div className="lbl">{t('dateTime')}</div>
            <div className="inputBox"><input type="datetime-local" value={date} onChange={e => setDate(e.target.value)} /></div>
          </div>
          {kind === 'borrow_in' && (
            <div className="field2">
              <div className="lbl">{t('uxferRefPrice')}</div>
              <div className="inputBox"><input inputMode="decimal" placeholder="3.69" value={refPrice} onChange={e => setRefPrice(e.target.value)} /></div>
            </div>
          )}
          <div className="field2">
            <div className="lbl">{t('uxferNote')}</div>
            <div className="inputBox"><input value={note} onChange={e => setNote(e.target.value)} /></div>
          </div>
        </div>
        {kind === 'borrow_in' && (
          <div style={{ fontSize: 10, color: 'var(--muted)' }}>{t('uxferRefPriceHint')}</div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 10, color: 'var(--muted)' }}>
            {t('uxferInStock')}: <strong className="mono">{fmtTotal(stockNow)} USDT</strong>
          </div>
          <button className="btn" type="button" disabled={saving} onClick={() => { void submit(); }}>
            {t('uxferSave')}
          </button>
        </div>
        {error && <div style={{ fontSize: 11, color: 'var(--bad)' }}>⚠ {error}</div>}
      </div>

      <div className="panel" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 800 }}>{t('uxferBalances')}</div>
        {balances.length === 0 ? (
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>{t('uxferSettled')}</div>
        ) : balances.map(b => (
          <div key={b.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, borderTop: '1px solid var(--line)', paddingTop: 6, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 12, fontWeight: 700 }}>{b.counterpartyName}</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              {b.owedToThem > 1e-6 && (
                <>
                  <span className="pill" style={{ fontSize: 10, color: 'var(--bad)' }}>{t('uxferIOwe')} {fmtTotal(b.owedToThem)} USDT</span>
                  <button className="rowBtn" type="button" onClick={() => prefill('borrow_repay', b.counterpartyName, b.owedToThem)}>{t('uxferRepay')}</button>
                </>
              )}
              {b.owedToMe > 1e-6 && (
                <>
                  <span className="pill" style={{ fontSize: 10, color: 'var(--good)' }}>{t('uxferOwesMe')} {fmtTotal(b.owedToMe)} USDT</span>
                  <button className="rowBtn" type="button" onClick={() => prefill('lend_return', b.counterpartyName, b.owedToMe)}>{t('uxferCollect')}</button>
                </>
              )}
              {b.owedToThem < -1e-6 && (
                <span className="pill" style={{ fontSize: 10 }}>{t('uxferOwesMe')} {fmtTotal(-b.owedToThem)} USDT</span>
              )}
              {b.owedToMe < -1e-6 && (
                <span className="pill" style={{ fontSize: 10 }}>{t('uxferIOwe')} {fmtTotal(-b.owedToMe)} USDT</span>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="panel" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ fontSize: 12, fontWeight: 800 }}>{t('uxferHistory')}</div>
        {active.length === 0 ? (
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>{t('uxferEmpty')}</div>
        ) : active.map(x => {
          const incoming = isTransferIn(x);
          const out = derived.transferCalc?.get(x.id);
          const unit = incoming ? inPriceById.get(x.id) : out?.unitCost ?? null;
          return (
            <div key={x.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, borderTop: '1px solid var(--line)', paddingTop: 6 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 700 }}>
                  {KINDS.find(k => k.kind === x.kind)?.icon} {t(kindLabel(x.kind))} · {x.counterpartyName}
                </div>
                <div style={{ fontSize: 10, color: 'var(--muted)' }}>
                  {fmtDate(x.ts)}
                  {unit ? ` · ${t('uxferCostAt')} ${fmtPrice(unit)}` : ''}
                  {x.note ? ` · ${x.note}` : ''}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                <span className="mono" style={{ fontSize: 12, fontWeight: 800, color: incoming ? 'var(--good)' : 'var(--bad)' }}>
                  {incoming ? '+' : '−'}{fmtTotal(x.amountUSDT)}
                </span>
                <button className="rowBtn" type="button" onClick={() => { void remove(x.id); }}>{t('uxferDelete')}</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
