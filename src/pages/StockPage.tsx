import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTrackerState } from '@/lib/useTrackerState';
import {
  fmtU,
  fmtP,
  fmtQ,
  fmtDate,
  fmtDur,
  fmtTotal,
  num,
  getWACOP,
  rangeLabel,
  batchCycleTime,
  computeFIFO,
  uid,
  getAccountBalance,
  getAllAccountBalances,
  deriveCashQAR,
  type TrackerState,
  type CashLedgerEntry,
} from '@/lib/tracker-helpers';
import { useTheme } from '@/lib/theme-context';
import { useT } from '@/lib/i18n';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { CashManagement } from '@/features/stock/components/CashManagement';
import { useIsMobile } from '@/hooks/use-mobile';
import '@/styles/tracker.css';
import { focusElementBySelectors } from '@/lib/focus-target';

const nowInput = () => new Date().toISOString().slice(0, 16);
const norm = (v: string) => v.trim().toLowerCase();

function inputFromTs(ts: number) {
  return new Date(ts).toISOString().slice(0, 16);
}

export default function StockPage() {
  const { settings, update } = useTheme();
  const t = useT();
  const isMobile = useIsMobile();

  const { state, derived, applyState } = useTrackerState({
    lowStockThreshold: settings.lowStockThreshold,
    priceAlertThreshold: settings.priceAlertThreshold,
    range: settings.range,
    currency: settings.currency,
  });

  const [batchDate, setBatchDate] = useState(nowInput());
  const [batchMode, setBatchMode] = useState<'QAR' | 'USDT'>('QAR');
  const [batchEntryMode, setBatchEntryMode] = useState<'price_vol' | 'qty_total' | 'qty_price'>('price_vol');
  const [batchUsdtQty, setBatchUsdtQty] = useState('');
  const [detailsOpen, setDetailsOpen] = useState<Record<string, boolean>>({});
  const [batchPrice, setBatchPrice] = useState('');
  const [batchAmount, setBatchAmount] = useState('');
  const [batchSupplier, setBatchSupplier] = useState('');
  const [batchNote, setBatchNote] = useState('');
  const [batchMsg, setBatchMsg] = useState('');
  const [selectedMonth, setSelectedMonth] = useState<string>(new Date().toISOString().slice(0, 7));

  const [supplierMenuOpen, setSupplierMenuOpen] = useState(false);
  const [supplierAddOpen, setSupplierAddOpen] = useState(false);
  const [newSupplierName, setNewSupplierName] = useState('');
  const [newSupplierPhone, setNewSupplierPhone] = useState('');

  const [editingBatchId, setEditingBatchId] = useState<string | null>(null);
  const [editDate, setEditDate] = useState('');
  const [editSource, setEditSource] = useState('');
  const [editSupplierCustom, setEditSupplierCustom] = useState('');
  const [editQty, setEditQty] = useState('');
  const [editPrice, setEditPrice] = useState('');
  const [editNote, setEditNote] = useState('');

  const [manualSuppliers, setManualSuppliers] = useState<Array<{ name: string; phone?: string }>>([]);

  // ── Cash Management tab ──────────────────────────────────────────
  const [searchParams] = useSearchParams();
  const [stockTab, setStockTab] = useState<'batches' | 'cash'>(
    searchParams.get('tab') === 'cash' ? 'cash' : 'batches'
  );
  const [fundingAccountId, setFundingAccountId] = useState<string>('');

  // Derive account balances for funding source selector
  const cashAccounts = state.cashAccounts || [];
  const cashLedger = state.cashLedger || [];
  const accountBalances = useMemo(() => getAllAccountBalances(cashAccounts, cashLedger), [cashAccounts, cashLedger]);
  const activeAccounts = useMemo(() => cashAccounts.filter(a => a.status === 'active'), [cashAccounts]);


  useEffect(() => {
    const focusStockId = searchParams.get('focusStockId');
    if (!focusStockId) return;
    window.setTimeout(() => {
      focusElementBySelectors([
        `#stock-${focusStockId}`,
        `[data-stock-id="${focusStockId}"]`,
      ]);
    }, 180);
  }, [searchParams, state.batches.length]);

  // Auto-select first account if none selected and accounts exist
  useEffect(() => {
    if (!fundingAccountId && activeAccounts.length > 0) {
      // Prefer the account with highest balance
      const best = [...activeAccounts].sort((a, b) => (accountBalances.get(b.id) || 0) - (accountBalances.get(a.id) || 0));
      setFundingAccountId(best[0]?.id || 'none');
    }
  }, [activeAccounts, fundingAccountId, accountBalances]);

  useEffect(() => {
    const next: TrackerState = {
      ...state,
      range: settings.range,
      currency: settings.currency,
      settings: {
        ...state.settings,
        lowStockThreshold: settings.lowStockThreshold,
        priceAlertThreshold: settings.priceAlertThreshold,
      },
    };
    applyState(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.range, settings.currency, settings.lowStockThreshold, settings.priceAlertThreshold]);

  const wacop = getWACOP(derived);
  const rLabel = rangeLabel(state.range);

  const query = (settings.searchQuery || '').trim().toLowerCase();
  const supplierLookup = useMemo(() => {
    const names = [
      ...manualSuppliers.map((s) => s.name),
      ...state.batches.map((b) => b.source),
    ].filter(Boolean);
    const unique = [...new Set(names.map((n) => n.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    if (!query) return unique;
    return unique.filter((n) => n.toLowerCase().includes(query));
  }, [manualSuppliers, query, state.batches]);

  const availableMonths = useMemo(() => {
    const months = new Set<string>();
    const curMonthKey = new Date().toISOString().slice(0, 7);
    months.add(curMonthKey);
    state.batches.forEach(b => {
      const d = new Date(b.ts);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      months.add(key);
    });
    return Array.from(months).sort().reverse();
  }, [state.batches]);

  const perf = useMemo(() => state.batches
    .map((b) => {
      const db = derived.batches.find((x) => x.id === b.id);
      const rem = db ? Math.max(0, db.remainingUSDT) : b.initialUSDT;
      const used = b.initialUSDT - rem;
      let profit = 0;
      for (const [, c] of derived.tradeCalc) {
        if (!c.ok) continue;
        const s = c.slices.find((sl) => sl.batchId === b.id);
        if (s) profit += s.qty * c.ppu;
      }
      return { ...b, remaining: rem, used, profit };
    })
    .filter((b) => {
      if (selectedMonth !== 'all') {
        const d = new Date(b.ts);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        if (key !== selectedMonth) return false;
      }
      if (!query) return true;
      return [fmtDate(b.ts), b.source, b.note].join(' ').toLowerCase().includes(query);
    })
    .sort((a, b) => b.ts - a.ts), [derived, query, state.batches, selectedMonth]);

  const suppliersForPanel = useMemo(() => [
    ...new Set(state.batches.map((b) => b.source.trim()).filter(Boolean)),
  ], [state.batches]);

  const addSupplier = () => {
    if (!newSupplierName.trim()) return;
    setManualSuppliers((prev) => {
      if (prev.some((s) => norm(s.name) === norm(newSupplierName))) return prev;
      return [...prev, { name: newSupplierName.trim(), phone: newSupplierPhone.trim() }];
    });
    setBatchSupplier(newSupplierName.trim());
    setSupplierAddOpen(false);
    setSupplierMenuOpen(false);
    setNewSupplierName('');
    setNewSupplierPhone('');
  };

  const addBatch = () => {
    const ts = new Date(batchDate).getTime();
    const source = batchSupplier.trim();

    let px = 0;
    let totalUSDT = 0;
    let volumeQAR = 0;

    if (batchEntryMode === 'price_vol') {
      px = Number(batchPrice);
      const rawAmt = Number(batchAmount);
      const errs: string[] = [];
      if (!Number.isFinite(ts)) errs.push(t('date'));
      if (!(px > 0)) errs.push(t('price'));
      if (!(rawAmt > 0)) errs.push(t('volume'));
      if (!source) errs.push(t('supplier'));
      if (errs.length) { setBatchMsg(`${t('fixFields')} ${errs.join(', ')}`); return; }
      volumeQAR = batchMode === 'USDT' ? rawAmt * px : rawAmt;
      totalUSDT = volumeQAR / px;
    } else if (batchEntryMode === 'qty_total') {
      totalUSDT = Number(batchUsdtQty);
      volumeQAR = Number(batchAmount);
      const errs: string[] = [];
      if (!Number.isFinite(ts)) errs.push(t('date'));
       if (!(totalUSDT > 0)) errs.push(t('usdtQtyValidation'));
       if (!(volumeQAR > 0)) errs.push(t('totalQarValidation'));
      if (!source) errs.push(t('supplier'));
      if (errs.length) { setBatchMsg(`${t('fixFields')} ${errs.join(', ')}`); return; }
      px = volumeQAR / totalUSDT;
    } else {
      totalUSDT = Number(batchUsdtQty);
      px = Number(batchPrice);
      const errs: string[] = [];
      if (!Number.isFinite(ts)) errs.push(t('date'));
      if (!(totalUSDT > 0)) errs.push(t('usdtQtyValidation'));
      if (!(px > 0)) errs.push(t('price'));
      if (!source) errs.push(t('supplier'));
      if (errs.length) { setBatchMsg(`${t('fixFields')} ${errs.join(', ')}`); return; }
      volumeQAR = totalUSDT * px;
    }

    const batchCostQAR = volumeQAR;
    const batchId = uid();

    // ── Multi-account cash deduction (new system) ──────────────────
    let nextCashLedger = [...(state.cashLedger || [])];
    let fundingLedgerEntryId: string | undefined;
    let selectedFundingAccountId: string | undefined;

    if (activeAccounts.length > 0 && fundingAccountId && fundingAccountId !== 'none') {
      const selectedAcc = activeAccounts.find(a => a.id === fundingAccountId);
      if (!selectedAcc) { setBatchMsg(t('fundingAccNotFound')); return; }
      const availBal = accountBalances.get(fundingAccountId) || 0;
      if (availBal < batchCostQAR) {
        setBatchMsg(`⚠ ${t('insufficientInAcc')} "${selectedAcc.name}". ${t('availableLbl')}: ${fmtTotal(availBal)} QAR, ${t('requiredLbl')}: ${fmtTotal(batchCostQAR)} QAR`);
        return;
      }
      const entryId = uid();
      const purchaseEntry: CashLedgerEntry = {
        id: entryId,
        ts: Date.now(),
        type: 'stock_purchase',
        accountId: fundingAccountId,
        direction: 'out',
        amount: batchCostQAR,
        currency: 'QAR',
        linkedEntityType: 'batch',
        linkedEntityId: batchId,
        note: `Stock purchase: ${fmtU(totalUSDT)} USDT @ ${fmtP(px)} from ${source}`,
      };
      nextCashLedger = [...nextCashLedger, purchaseEntry];
      fundingLedgerEntryId = entryId;
      selectedFundingAccountId = fundingAccountId;
    }

    // ── Legacy cashQAR backward-compat deduction ────────────────────
    const currentCash = num(state.cashQAR, 0);
    const newCashFromLedger = activeAccounts.length > 0
      ? deriveCashQAR(cashAccounts, nextCashLedger)
      : Math.max(0, currentCash - batchCostQAR);
    const cashTx: import('@/lib/tracker-helpers').CashTransaction = {
      id: uid(),
      ts: Date.now(),
      type: 'batch_purchase',
      amount: Math.min(batchCostQAR, currentCash),
      balanceAfter: newCashFromLedger,
      owner: state.cashOwner || '',
      bankAccount: activeAccounts.find(a => a.id === fundingAccountId)?.name || '',
      note: `Stock purchase: ${fmtU(totalUSDT)} USDT @ ${fmtP(px)} from ${source}`,
    };

    const next: TrackerState = {
      ...state,
      cashQAR: newCashFromLedger,
      cashHistory: [...(state.cashHistory || []), cashTx],
      cashLedger: nextCashLedger,
      batches: [
        ...state.batches,
        {
          id: batchId,
          ts,
          source,
          note: batchNote.trim(),
          buyPriceQAR: px,
          initialUSDT: totalUSDT,
          revisions: [],
          fundingAccountId: selectedFundingAccountId,
          fundingLedgerEntryId,
        },
      ],
    };

    applyState(next);
    setBatchAmount('');
    setBatchPrice('');
    setBatchUsdtQty('');
    setBatchSupplier('');
    setBatchNote('');
    const fundingAccName = activeAccounts.find(a => a.id === fundingAccountId)?.name;
    const deductMsg = fundingAccName
       ? ` · ${fmtTotal(batchCostQAR)} QAR ${t('deductedFromAccount')} "${fundingAccName}"`
       : currentCash > 0 ? ` · ${fmtTotal(Math.min(batchCostQAR, currentCash))} QAR ${t('deductedFromCash')}` : '';
    setBatchMsg(t('batchAdded') + deductMsg);
  };

  const openEdit = (id: string) => {
    const b = state.batches.find((x) => x.id === id);
    if (!b) return;
    setEditingBatchId(id);
    setEditDate(inputFromTs(b.ts));
    setEditSource(b.source);
    setEditSupplierCustom('');
    setEditQty(String(b.initialUSDT));
    setEditPrice(String(b.buyPriceQAR));
    setEditNote(b.note || '');
  };

  const saveBatchEdit = () => {
    if (!editingBatchId) return;
    const ts = new Date(editDate).getTime();
    const qty = Number(editQty);
    const px = Number(editPrice);
    const src = editSource.trim();
    if (!Number.isFinite(ts) || !(qty > 0) || !(px > 0) || !src) {
      return;
    }

    const existingBatch = state.batches.find(b => b.id === editingBatchId);
    const oldCost = existingBatch ? existingBatch.initialUSDT * existingBatch.buyPriceQAR : 0;
    const newCost = qty * px;
    const delta = newCost - oldCost; // positive = extra spend, negative = refund

    // ── Ledger adjustment if multi-account is active ─────────────
    let nextCashLedger = [...(state.cashLedger || [])];
    if (Math.abs(delta) > 0.01 && existingBatch?.fundingAccountId) {
      const adjustEntry: CashLedgerEntry = {
        id: uid(),
        ts: Date.now(),
        type: 'stock_edit_adjust',
        accountId: existingBatch.fundingAccountId,
        direction: delta > 0 ? 'out' : 'in',
        amount: Math.abs(delta),
        currency: 'QAR',
        linkedEntityType: 'batch',
        linkedEntityId: editingBatchId,
        note: `Batch edit: cost ${delta > 0 ? 'increased' : 'reduced'} by ${fmtTotal(Math.abs(delta))} QAR`,
      };
      nextCashLedger = [...nextCashLedger, adjustEntry];
    }

    const nextBatches = state.batches.map((b) => {
      if (b.id !== editingBatchId) return b;
      return {
        ...b,
        ts,
        source: src,
        note: editNote.trim(),
        initialUSDT: qty,
        buyPriceQAR: px,
        revisions: [
          { at: Date.now(), before: { ts: b.ts, source: b.source, note: b.note, initialUSDT: b.initialUSDT, buyPriceQAR: b.buyPriceQAR } },
          ...b.revisions,
        ].slice(0, 20),
      };
    });

    const newCashQAR = (state.cashAccounts || []).length > 0
      ? deriveCashQAR(state.cashAccounts, nextCashLedger)
      : Math.max(0, num(state.cashQAR, 0) - delta);

    applyState({ ...state, batches: nextBatches, cashLedger: nextCashLedger, cashQAR: newCashQAR });
    setEditingBatchId(null);
  };

  const deleteBatch = () => {
    if (!editingBatchId) return;
    const batch = state.batches.find(b => b.id === editingBatchId);
    if (!batch) return;

    const batchCostQAR = batch.initialUSDT * batch.buyPriceQAR;

    // ── Double-refund guard ───────────────────────────────────────
    const alreadyRefunded = (state.cashLedger || []).some(
      e => e.type === 'stock_refund' && e.linkedEntityId === editingBatchId
    );
    if (alreadyRefunded) {
      // Batch already refunded — just remove from list
      applyState({ ...state, batches: state.batches.filter(b => b.id !== editingBatchId) });
      setEditingBatchId(null);
      return;
    }

    // ── Multi-account refund (new system) ─────────────────────────
    let nextCashLedger = [...(state.cashLedger || [])];
    if (batch.fundingAccountId && (state.cashAccounts || []).length > 0) {
      const refundEntry: CashLedgerEntry = {
        id: uid(),
        ts: Date.now(),
        type: 'stock_refund',
        accountId: batch.fundingAccountId,
        direction: 'in',
        amount: batchCostQAR,
        currency: 'QAR',
        linkedEntityType: 'batch',
        linkedEntityId: editingBatchId,
        note: `Batch refund: ${fmtU(batch.initialUSDT)} USDT @ ${fmtP(batch.buyPriceQAR)} from ${batch.source || 'unknown'}`,
      };
      nextCashLedger = [...nextCashLedger, refundEntry];
    }

    // ── Legacy cashQAR refund ─────────────────────────────────────
    const currentCash = num(state.cashQAR, 0);
    const newCashQAR = (state.cashAccounts || []).length > 0
      ? deriveCashQAR(state.cashAccounts, nextCashLedger)
      : currentCash + batchCostQAR;
    const cashTx: import('@/lib/tracker-helpers').CashTransaction = {
      id: uid(),
      ts: Date.now(),
      type: 'batch_refund' as any,
      amount: batchCostQAR,
      balanceAfter: newCashQAR,
      owner: state.cashOwner || '',
      bankAccount: state.cashAccounts?.find(a => a.id === batch.fundingAccountId)?.name || '',
      note: `Batch deleted: ${fmtU(batch.initialUSDT)} USDT @ ${fmtP(batch.buyPriceQAR)} from ${batch.source || 'unknown'}`,
    };

    applyState({
      ...state,
      batches: state.batches.filter(b => b.id !== editingBatchId),
      cashQAR: newCashQAR,
      cashHistory: [...(state.cashHistory || []), cashTx],
      cashLedger: nextCashLedger,
    });
    setEditingBatchId(null);
  };

  return (
    <div className="tracker-root" dir={t.isRTL ? 'rtl' : 'ltr'} style={{ padding: isMobile ? '10px max(10px, env(safe-area-inset-right)) max(10px, env(safe-area-inset-bottom)) max(10px, env(safe-area-inset-left))' : 12, display: 'flex', flexDirection: 'column', gap: 10, minHeight: isMobile ? 'calc(100dvh - env(safe-area-inset-top))' : '100%' }}>

      {/* ── Stock Page Tab Switcher ─────────────────────────────── */}
      <div style={{ display: 'flex', gap: 2, background: 'var(--panel)', borderRadius: 8, padding: 3, alignSelf: isMobile ? 'stretch' : 'flex-start', width: isMobile ? '100%' : undefined }}>
        <button
          onClick={() => setStockTab('batches')}
          style={{ padding: isMobile ? '8px 12px' : '6px 16px', minHeight: isMobile ? 36 : undefined, flex: isMobile ? 1 : undefined, fontSize: 12, fontWeight: 700, border: 'none', cursor: 'pointer', borderRadius: 6, background: stockTab === 'batches' ? 'var(--brand)' : 'transparent', color: stockTab === 'batches' ? '#fff' : 'var(--muted)', transition: 'all 0.12s' }}>
          📦 {t('batches')}
        </button>
        <button
          onClick={() => setStockTab('cash')}
          style={{ padding: isMobile ? '8px 12px' : '6px 16px', minHeight: isMobile ? 36 : undefined, flex: isMobile ? 1 : undefined, fontSize: 12, fontWeight: 700, border: 'none', cursor: 'pointer', borderRadius: 6, background: stockTab === 'cash' ? 'var(--brand)' : 'transparent', color: stockTab === 'cash' ? '#fff' : 'var(--muted)', transition: 'all 0.12s', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
          {t('cashTabLabel')}
          {cashAccounts.length > 0 && <span style={{ background: 'color-mix(in srgb, var(--good) 20%, transparent)', color: 'var(--good)', borderRadius: 4, padding: '1px 5px', fontSize: 9, fontWeight: 800 }}>{cashAccounts.filter(a => a.status === 'active').length}</span>}
        </button>
      </div>

      {/* ── CASH MANAGEMENT TAB ────────────────────────────────── */}
      {stockTab === 'cash' && (
        <CashManagement state={state} applyState={applyState} />
      )}

      {/* ── BATCHES TAB ────────────────────────────────────────── */}
      {stockTab === 'batches' && (
      <div className="twoColPage" style={isMobile ? { display: 'flex', flexDirection: 'column', gap: 10 } : undefined}>
        <div>
          <div 
            className="orders-tab-bar" 
            style={{ 
              marginBottom: 8, 
              background: 'transparent', 
              border: 'none', 
              padding: 0, 
              gap: 8,
              boxShadow: 'none'
            }}
          >
            <button
              onClick={() => setSelectedMonth('all')}
              className={`orders-tab-btn ${selectedMonth === 'all' ? 'active' : ''}`}
              style={{ fontSize: 10, padding: '5px 12px', borderRadius: 8 }}
            >
              {t('allMonths')}
            </button>
            {availableMonths.map(m => {
              const [y, mm] = m.split('-');
              const label = new Date(parseInt(y), parseInt(mm) - 1).toLocaleString(t.lang === 'ar' ? 'ar-EG' : 'en-US', { month: 'short', year: '2-digit' });
              return (
                <button
                  key={m}
                  onClick={() => setSelectedMonth(m)}
                  className={`orders-tab-btn ${selectedMonth === m ? 'active' : ''}`}
                  style={{ fontSize: 10, padding: '5px 12px', borderRadius: 8 }}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, gap: 8 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 800 }}>{t('batches')}</div>
              <div style={{ fontSize: 10, color: 'var(--muted)' }}>{t('fifoProgress')}</div>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <span className="pill">{rLabel}</span>
            </div>
          </div>

          {perf.length === 0 ? (
            <div className="empty">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
              </svg>
              <div className="empty-t">{t('noBatchesShort')}</div>
              <div className="empty-s">{t('addFirstPurchase')}</div>
            </div>
          ) : isMobile ? (
            <div style={{ display: 'grid', gap: 6 }}>
              {perf.map((b) => {
                const rem = Number.isFinite(b.remaining) ? b.remaining : b.initialUSDT;
                const pct = b.initialUSDT > 0 ? rem / b.initialUSDT : 0;
                const prog = Math.max(0, Math.min(100, pct * 100));
                const ct = batchCycleTime(state, derived, b.id);
                const st = rem <= 1e-9 ? t('depleted') : rem < b.initialUSDT ? t('partial') : t('fresh');
                const stCls = rem <= 1e-9 ? 'bad' : rem < b.initialUSDT ? 'warn' : 'good';
                return (
                  <div key={b.id} className="panel" style={{ padding: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, marginBottom: 4 }}>
                      <div>
                        <div className="mono" style={{ fontSize: 10, color: 'var(--muted)' }}>{fmtDate(b.ts)}</div>
                        <div style={{ fontSize: 12, fontWeight: 800, lineHeight: 1.2 }}>{b.source || '—'}</div>
                      </div>
                      <span className={`pill ${stCls}`} style={{ alignSelf: 'flex-start' }}>{st}</span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, fontSize: 10, marginBottom: 6 }}>
                      <div><span className="muted">{t('total')}:</span> <strong className="mono">{fmtU(b.initialUSDT)}</strong></div>
                      <div><span className="muted">{t('buy')}:</span> <strong className="mono">{fmtP(b.buyPriceQAR)}</strong></div>
                      <div><span className="muted">{t('rem')}:</span> <strong className="mono">{fmtU(rem)}</strong></div>
                      <div><span className="muted">{t('profit')}:</span> <strong className="mono" style={{ color: (b.profit || 0) >= 0 ? 'var(--good)' : 'var(--bad)' }}>{(b.profit || 0) >= 0 ? '+' : ''}{fmtQ(b.profit || 0)}</strong></div>
                    </div>
                    <div style={{ marginBottom: 6 }}>
                      <div className="prog"><span style={{ width: `${prog.toFixed(0)}%` }} /></div>
                      <div className="muted" style={{ fontSize: 9, marginTop: 2 }}>{prog.toFixed(0)}% {t('remainingPct')}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: detailsOpen[b.id] ? 6 : 0 }}>
                      {ct !== null && <span className="cycle-badge">{fmtDur(ct)}</span>}
                      <button className="rowBtn" style={{ minHeight: 30, padding: '0 8px', fontSize: 11 }} onClick={() => setDetailsOpen(prev => ({ ...prev, [b.id]: !prev[b.id] }))}>{detailsOpen[b.id] ? t('hideDetails') : t('details')}</button>
                      <button className="rowBtn" style={{ minHeight: 30, padding: '0 8px', fontSize: 11 }} onClick={() => openEdit(b.id)}>{t('edit')}</button>
                    </div>
                    {detailsOpen[b.id] && (
                      <div style={{ background: 'color-mix(in srgb, var(--brand) 3%, var(--bg))', border: '1px solid color-mix(in srgb, var(--line) 80%, transparent)', borderRadius: 8, padding: 7, display: 'grid', gap: 4, fontSize: 10 }}>
                        <div><span className="muted">{t('batchDate')}:</span> <strong>{new Date(b.ts).toLocaleString()}</strong></div>
                        <div><span className="muted">{t('batchQty')}:</span> <strong>{fmtU(b.initialUSDT)} USDT</strong></div>
                        <div><span className="muted">{t('batchBuyPrice')}:</span> <strong>{fmtP(b.buyPriceQAR)} QAR</strong></div>
                        <div><span className="muted">{t('batchRemaining')}:</span> <strong>{fmtU(rem)} USDT</strong></div>
                        <div><span className="muted">{t('cost')}:</span> <strong>{fmtQ(b.initialUSDT * b.buyPriceQAR)} QAR</strong></div>
                        {b.note && <div><span className="muted">{t('batchNotes')}:</span> <strong>{b.note}</strong></div>}
                        {ct !== null && <div><span className="muted">{t('cycleTime')}:</span> <strong>{fmtDur(ct)}</strong></div>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="tableWrap">
              <table>
                <thead>
                  <tr>
                    <th>{t('date')}</th>
                    <th>{t('source')}</th>
                    <th className="r">{t('total')}</th>
                    <th className="r">{t('buy')}</th>
                    <th className="r">{t('rem')}</th>
                    <th className="hide-mobile">{t('usage')}</th>
                    <th className="r hide-mobile">{t('profit')}</th>
                    <th>{t('statusEdit')}</th>
                  </tr>
                </thead>
                <tbody>
                  {perf.map((b) => {
                    const rem = Number.isFinite(b.remaining) ? b.remaining : b.initialUSDT;
                    const pct = b.initialUSDT > 0 ? rem / b.initialUSDT : 0;
                    const prog = Math.max(0, Math.min(100, pct * 100));
                    const ct = batchCycleTime(state, derived, b.id);
                    const st = rem <= 1e-9 ? t('depleted') : rem < b.initialUSDT ? t('partial') : t('fresh');
                    const stCls = rem <= 1e-9 ? 'bad' : rem < b.initialUSDT ? 'warn' : 'good';

                    return (
                      <React.Fragment key={b.id}>
                      <tr>
                        <td className="mono">{fmtDate(b.ts)}</td>
                        <td>{b.source || '—'}</td>
                        <td className="mono r">{fmtU(b.initialUSDT)}</td>
                        <td className="mono r">{fmtP(b.buyPriceQAR)}</td>
                        <td className="mono r">{fmtU(rem)}</td>
                        <td className="hide-mobile">
                          <div className="prog"><span style={{ width: `${prog.toFixed(0)}%` }} /></div>
                          <div className="muted" style={{ fontSize: 9, marginTop: 2 }}>{prog.toFixed(0)}% {t('remainingPct')}</div>
                        </td>
                        <td className="mono r hide-mobile" style={{ color: (b.profit || 0) >= 0 ? 'var(--good)' : 'var(--bad)', fontWeight: 700 }}>
                          {(b.profit || 0) >= 0 ? '+' : ''}{fmtQ(b.profit || 0)}
                        </td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                            <span className={`pill ${stCls}`}>{st}</span>
                            {ct !== null && <span className="cycle-badge">{fmtDur(ct)}</span>}
                            <button className="rowBtn" onClick={() => setDetailsOpen(prev => ({ ...prev, [b.id]: !prev[b.id] }))}>{detailsOpen[b.id] ? t('hideDetails') : t('details')}</button>
                            <button className="rowBtn" onClick={() => openEdit(b.id)}>{t('edit')}</button>
                          </div>
                        </td>
                      </tr>
                      {detailsOpen[b.id] && (
                        <tr>
                          <td colSpan={8} style={{ padding: '8px 12px', background: 'color-mix(in srgb, var(--brand) 3%, var(--bg))' }}>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, fontSize: 11 }}>
                              <div><span className="muted">{t('batchDate')}:</span> <strong>{new Date(b.ts).toLocaleString()}</strong></div>
                              <div><span className="muted">{t('batchSource')}:</span> <strong>{b.source || '—'}</strong></div>
                              <div><span className="muted">{t('batchQty')}:</span> <strong>{fmtU(b.initialUSDT)} USDT</strong></div>
                              <div><span className="muted">{t('batchBuyPrice')}:</span> <strong>{fmtP(b.buyPriceQAR)} QAR</strong></div>
                              <div><span className="muted">{t('batchRemaining')}:</span> <strong>{fmtU(rem)} USDT</strong></div>
                              <div><span className="muted">{t('batchUtilization')}:</span> <strong>{(100 - prog).toFixed(0)}% {t('usage')}</strong></div>
                              <div><span className="muted">{t('cost')}:</span> <strong>{fmtQ(b.initialUSDT * b.buyPriceQAR)} QAR</strong></div>
                              {b.note && <div><span className="muted">{t('batchNotes')}:</span> <strong>{b.note}</strong></div>}
                              {ct !== null && <div><span className="muted">{t('cycleTime')}:</span> <strong>{fmtDur(ct)}</strong></div>}
                            </div>
                          </td>
                        </tr>
                      )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {suppliersForPanel.length > 0 && (
            <div className="panel" style={{ marginTop: 9 }}>
              <div className="panel-head">
                <h2>📦 {t('suppliers')}</h2>
                <span className="pill">{t('autoTracked')}</span>
              </div>
              <div className="panel-body" style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {suppliersForPanel.map((s) => (
                  <span key={s} className="pill" style={{ cursor: 'pointer' }} onClick={() => update({ searchQuery: s })}>{s}</span>
                ))}
              </div>
            </div>
          )}
        </div>

        <div>
          <div className="formPanel salePanel" style={isMobile ? { padding: 8, borderRadius: 10 } : undefined}>
            <div className="hdr">{t('addBatchTitle')}</div>
            <div className="inner" style={isMobile ? { display: 'grid', gap: 10, paddingBottom: 'max(8px, env(safe-area-inset-bottom))' } : undefined}>
              {wacop && (
                <div className="bannerRow">
                  <span className="bLbl">{t('currentAvPrice')}</span>
                  <span className="bVal">{fmtP(wacop)}</span>
                  <span className="bSpacer" />
                  <span className="bPill">{t('avg')}</span>
                </div>
              )}
              <div className="field2">
                <div className="lbl">{t('dateTime')}</div>
                <div className="inputBox"><input type="datetime-local" value={batchDate} onChange={(e) => setBatchDate(e.target.value)} /></div>
              </div>
              <div className="field2">
                <div className="lbl">{t('entryModeLabel')}</div>
                <div className="modeToggle" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 0 }}>
                  <button className={batchEntryMode === 'price_vol' ? 'active' : ''} type="button" onClick={() => { setBatchEntryMode('price_vol'); setBatchUsdtQty(''); }} style={{ fontSize: isMobile ? 10 : 9, padding: isMobile ? '8px 6px' : '6px 4px', minHeight: isMobile ? 34 : undefined }}>
                    {t('entryModePriceVol')}
                  </button>
                  <button className={batchEntryMode === 'qty_total' ? 'active' : ''} type="button" onClick={() => { setBatchEntryMode('qty_total'); setBatchPrice(''); setBatchAmount(''); }} style={{ fontSize: isMobile ? 10 : 9, padding: isMobile ? '8px 6px' : '6px 4px', minHeight: isMobile ? 34 : undefined }}>
                    {t('entryModeUsdtQar')}
                  </button>
                  <button className={batchEntryMode === 'qty_price' ? 'active' : ''} type="button" onClick={() => { setBatchEntryMode('qty_price'); setBatchAmount(''); }} style={{ fontSize: isMobile ? 10 : 9, padding: isMobile ? '8px 6px' : '6px 4px', minHeight: isMobile ? 34 : undefined }}>
                    {t('entryModeUsdtPrice')}
                  </button>
                </div>
              </div>

              {batchEntryMode === 'price_vol' && (
                <>
                  <div className="field2">
                    <div className="lbl">{t('currencyMode')}</div>
                    <div className="modeToggle">
                      <button className={batchMode === 'QAR' ? 'active' : ''} type="button" onClick={() => setBatchMode('QAR')}>📦 QAR</button>
                      <button className={batchMode === 'USDT' ? 'active' : ''} type="button" onClick={() => setBatchMode('USDT')}>💲 USDT</button>
                    </div>
                  </div>
                  <div className="g2tight" style={isMobile ? { display: 'grid', gridTemplateColumns: '1fr', gap: 8 } : undefined}>
                    <div className="field2">
                      <div className="lbl">{t('buyPriceQar')}</div>
                      <div className="inputBox"><input inputMode="decimal" placeholder="3.74" value={batchPrice} onChange={(e) => setBatchPrice(e.target.value)} /></div>
                    </div>
                    <div className="field2">
                      <div className="lbl">{batchMode === 'QAR' ? t('volumeQar') : t('amountUsdt')}</div>
                      <div className="inputBox"><input inputMode="decimal" placeholder="96,050" value={batchAmount} onChange={(e) => setBatchAmount(e.target.value)} /></div>
                    </div>
                  </div>
                </>
              )}

              {batchEntryMode === 'qty_total' && (
                <>
                  <div className="g2tight" style={isMobile ? { display: 'grid', gridTemplateColumns: '1fr', gap: 8 } : undefined}>
                    <div className="field2">
                      <div className="lbl">{t('usdtBought')}</div>
                      <div className="inputBox"><input inputMode="decimal" placeholder="25,000" value={batchUsdtQty} onChange={(e) => setBatchUsdtQty(e.target.value)} /></div>
                    </div>
                    <div className="field2">
                      <div className="lbl">{t('totalQarPaid')}</div>
                      <div className="inputBox"><input inputMode="decimal" placeholder="93,500" value={batchAmount} onChange={(e) => setBatchAmount(e.target.value)} /></div>
                    </div>
                  </div>
                  {Number(batchUsdtQty) > 0 && Number(batchAmount) > 0 && (
                    <div className="previewBox" style={{ marginTop: 4, padding: '6px 10px', fontSize: 11 }}>
                      <span style={{ color: 'var(--t2)' }}>{t('avgPriceCalc')} </span>
                      <span className="mono" style={{ fontWeight: 700, color: 'var(--brand)' }}>
                        {fmtP(Number(batchAmount) / Number(batchUsdtQty))} QAR/USDT
                      </span>
                    </div>
                  )}
                </>
              )}

              {batchEntryMode === 'qty_price' && (
                <>
                  <div className="g2tight" style={isMobile ? { display: 'grid', gridTemplateColumns: '1fr', gap: 8 } : undefined}>
                    <div className="field2">
                      <div className="lbl">{t('usdtBought')}</div>
                      <div className="inputBox"><input inputMode="decimal" placeholder="25,000" value={batchUsdtQty} onChange={(e) => setBatchUsdtQty(e.target.value)} /></div>
                    </div>
                    <div className="field2">
                      <div className="lbl">{t('buyPriceQar')}</div>
                      <div className="inputBox"><input inputMode="decimal" placeholder="3.74" value={batchPrice} onChange={(e) => setBatchPrice(e.target.value)} /></div>
                    </div>
                  </div>
                  {Number(batchUsdtQty) > 0 && Number(batchPrice) > 0 && (
                    <div className="previewBox" style={{ marginTop: 4, padding: '6px 10px', fontSize: 11 }}>
                      <span style={{ color: 'var(--t2)' }}>{t('totalQarCalc')} </span>
                      <span className="mono" style={{ fontWeight: 700, color: 'var(--brand)' }}>
                        {fmtTotal(Number(batchUsdtQty) * Number(batchPrice))} QAR
                      </span>
                    </div>
                  )}
                </>
              )}
              <div className="field2" style={{ gridColumn: 'span 2' }}>
                <div className="lbl">{t('supplier')}</div>
                <div className="lookupShell">
                  <div className="inputBox lookupBox" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <input
                      placeholder={t('searchOrTypeSupplier')}
                      autoComplete="off"
                      value={batchSupplier}
                      onChange={(e) => {
                        setBatchSupplier(e.target.value);
                        setSupplierMenuOpen(true);
                      }}
                      onFocus={() => setSupplierMenuOpen(true)}
                    />
                    <button className="sideAction" type="button" title={t('showSuppliers')} onClick={() => setSupplierMenuOpen((v) => !v)}>⌄</button>
                    <button
                      className="sideAction"
                      type="button"
                      title={t('addSupplierTitle')}
                      onClick={() => {
                        setNewSupplierName(batchSupplier);
                        setSupplierAddOpen((v) => !v);
                      }}
                    >
                      +
                    </button>
                  </div>

                  {supplierMenuOpen && (
                    <div className="lookupMenu">
                      {supplierLookup.length ? supplierLookup.map((name) => (
                        <button
                          key={name}
                          className="lookupItem"
                          type="button"
                          onClick={() => {
                            setBatchSupplier(name);
                            setSupplierMenuOpen(false);
                          }}
                        >
                          <span>{name}</span>
                          <span className="lookupMeta">{t('supplier')}</span>
                        </button>
                      )) : (
                        <div className="lookupItem" style={{ cursor: 'default' }}>
                          <span>{t('noSuppliersYet')}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <div className="lookupHint">{t('supplierHint')}</div>
              </div>

              {supplierAddOpen && (
                <div className="previewBox" style={{ marginTop: 2 }}>
                  <div className="pt">{t('addSupplierTitle')}</div>
                  <div className="g2tight" style={{ marginBottom: 6 }}>
                    <div className="field2">
                      <div className="lbl">{t('name')}</div>
                      <div className="inputBox"><input value={newSupplierName} onChange={(e) => setNewSupplierName(e.target.value)} placeholder={t('supplierName')} /></div>
                    </div>
                    <div className="field2">
                      <div className="lbl">{t('phone')}</div>
                      <div className="inputBox"><input value={newSupplierPhone} onChange={(e) => setNewSupplierPhone(e.target.value)} placeholder="+974 ..." /></div>
                    </div>
                  </div>
                  <div className="formActions">
                    <button className="btn secondary" onClick={() => setSupplierAddOpen(false)}>{t('cancel')}</button>
                    <button className="btn" onClick={addSupplier}>{t('addSupplierTitle')}</button>
                  </div>
                </div>
              )}

              <div className="field2">
                <div className="lbl">{t('note')}</div>
                <div className="inputBox"><input placeholder={t('optionalNote')} value={batchNote} onChange={(e) => setBatchNote(e.target.value)} /></div>
              </div>

              {/* ── Funding Source (multi-account) ── */}
              {activeAccounts.length > 0 && (
                <div className="field2">
                  <div className="lbl">{t('fundingSourceLbl')}</div>
                  <select
                    value={fundingAccountId}
                    onChange={e => setFundingAccountId(e.target.value)}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                    style={{ color: 'hsl(var(--foreground))', minHeight: isMobile ? 36 : undefined }}>
                    <option value="none">🚫 {t('noFundingSource')}</option>
                    {activeAccounts.map(a => {
                      const bal = accountBalances.get(a.id) || 0;
                      return <option key={a.id} value={a.id}>{a.name} · {fmtTotal(bal)} {a.currency}</option>;
                    })}
                  </select>
                  {fundingAccountId && fundingAccountId !== 'none' && (() => {
                    const acc = activeAccounts.find(a => a.id === fundingAccountId);
                    const bal = accountBalances.get(fundingAccountId) || 0;
                    return (
                      <div style={{ fontSize: isMobile ? 11 : 10, marginTop: 4, color: 'var(--muted)' }}>
                        {t('availableLbl')}: <strong style={{ color: bal < 10000 ? 'var(--warn)' : 'var(--good)' }}>{fmtTotal(bal)} {acc?.currency}</strong>
                      </div>
                    );
                  })()}
                </div>
              )}
              {activeAccounts.length === 0 && (
                <div style={{ fontSize: 10, color: 'var(--muted)', padding: '6px 8px', background: 'color-mix(in srgb, var(--brand) 5%, transparent)', borderRadius: 6, border: '1px solid var(--line)' }}>
                  💡 {t('setupCashAccountsHint')} <button type="button" onClick={() => setStockTab('cash')} style={{ background: 'none', border: 'none', color: 'var(--brand)', cursor: 'pointer', fontSize: 10, fontWeight: 700, padding: 0 }}>{t('setupCashAccHint2')}</button> {t('setupCashAccHint3')}
                </div>
              )}

              <div className="formActions"><button className="btn" style={{ minHeight: isMobile ? 40 : undefined, width: isMobile ? '100%' : undefined, fontSize: isMobile ? 12 : undefined }} onClick={addBatch}>{t('addBatchTitle')}</button></div>
              <div className={`msg ${batchMsg.includes(t('fixFields')) || batchMsg.includes('⚠') ? 'bad' : ''}`}>{batchMsg}</div>
            </div>
          </div>
        </div>
      </div>
      )} {/* end batches tab */}

      {/* ─── EDIT BATCH DIALOG ─── */}
      {(() => {
        const editBatch = editingBatchId ? state.batches.find(b => b.id === editingBatchId) : null;
        const editDerived = editingBatchId ? derived.batches.find(b => b.id === editingBatchId) : null;
        const editRemaining = editDerived ? Math.max(0, editDerived.remainingUSDT) : (editBatch?.initialUSDT ?? 0);
        const editUsed = (editBatch?.initialUSDT ?? 0) - editRemaining;
        const editInvested = editBatch ? editBatch.initialUSDT * editBatch.buyPriceQAR : 0;
        const editFullyDepleted = editRemaining <= 1e-9 && (editBatch?.initialUSDT ?? 0) > 0;
        const editPartial = editUsed > 1e-9 && !editFullyDepleted;
        let editProfit = 0;
        for (const [, c] of derived.tradeCalc) {
          if (!c.ok) continue;
          const sl = c.slices.find(s => s.batchId === editingBatchId);
          if (sl) editProfit += sl.qty * c.ppu;
        }
        const knownSuppliers = [...new Set(state.batches.map(b => b.source.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));

        return (
          <Dialog open={!!editingBatchId} onOpenChange={(open) => !open && setEditingBatchId(null)}>
            <DialogContent className="tracker-root" style={{ maxWidth: isMobile ? 'min(96vw, 520px)' : 500, width: isMobile ? '96vw' : undefined, maxHeight: isMobile ? '86dvh' : undefined, overflowY: isMobile ? 'auto' : undefined, background: 'var(--bg)', border: `1px solid ${editFullyDepleted ? 'color-mix(in srgb, var(--bad) 30%, var(--line))' : 'color-mix(in srgb, var(--good) 25%, var(--line))'}`, borderRadius: 12, padding: isMobile ? '14px 12px calc(12px + env(safe-area-inset-bottom))' : 24, gap: 0 }}>
              <DialogHeader style={{ marginBottom: 14 }}>
                <DialogTitle style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>{t('editBatchInPlace')}</DialogTitle>
              </DialogHeader>

              {/* Depletion warning */}
              {(editFullyDepleted || editPartial) && (
                <div style={{ background: `color-mix(in srgb, ${editFullyDepleted ? 'var(--bad)' : 'var(--warn)'} 10%, transparent)`, border: `1px solid color-mix(in srgb, ${editFullyDepleted ? 'var(--bad)' : 'var(--warn)'} 28%, transparent)`, borderRadius: 6, padding: '8px 12px', fontSize: 11, color: editFullyDepleted ? 'var(--bad)' : 'var(--warn)', marginBottom: 14, lineHeight: 1.5, display: 'flex', gap: 7, alignItems: 'flex-start' }}>
                  <span style={{ flexShrink: 0 }}>⚠</span>
                  <span>{editFullyDepleted ? t('batchFullyDepletedWarn') : t('batchPartialWarn')}</span>
                </div>
              )}

              {/* Date & time */}
              <div className="field2" style={{ marginBottom: 10 }}>
                <div className="lbl">{t('dateTime')}</div>
                <div className="inputBox"><input type="datetime-local" value={editDate} onChange={(e) => setEditDate(e.target.value)} /></div>
              </div>

              {/* Supplier — dropdown + custom input */}
              <div className="field2" style={{ marginBottom: 4 }}>
                <div className="lbl">{t('supplier')}</div>
                <div style={{ position: 'relative' }}>
                  <select
                    value={knownSuppliers.includes(editSource) && !editSupplierCustom ? editSource : ''}
                    onChange={e => { setEditSource(e.target.value); setEditSupplierCustom(''); }}
                    style={{ width: '100%', minHeight: isMobile ? 42 : undefined, padding: '8px 32px 8px 10px', fontSize: 12, borderRadius: 6, border: '1px solid var(--line)', background: 'var(--input-bg)', color: 'var(--text)', appearance: 'none', cursor: 'pointer', outline: 'none' }}
                  >
                    <option value="">{t('noneSelected')}</option>
                    {knownSuppliers.map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--muted)' }}><path d="M6 9l6 6 6-6"/></svg>
                </div>
              </div>
              <div className="inputBox" style={{ marginBottom: 10 }}>
                <input
                  value={editSupplierCustom}
                  onChange={e => { setEditSupplierCustom(e.target.value); setEditSource(e.target.value); }}
                  placeholder={t('customSupplierPlaceholder')}
                  style={{ width: '100%' }}
                />
              </div>

              {/* Qty USDT | Buy price QAR */}
              <div className="g2tight" style={{ marginBottom: 4, ...(isMobile ? { display: 'grid', gridTemplateColumns: '1fr', gap: 8 } : {}) }}>
                <div className="field2">
                  <div className="lbl">{t('qtyUsdt')}</div>
                  <div className="inputBox"><input inputMode="decimal" value={editQty} onChange={(e) => setEditQty(e.target.value)} /></div>
                </div>
                <div className="field2">
                  <div className="lbl">{t('buyPriceQar')}</div>
                  <div className="inputBox"><input inputMode="decimal" value={editPrice} onChange={(e) => setEditPrice(e.target.value)} /></div>
                </div>
              </div>
              {editUsed > 1e-9 && (
                <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 10 }}>
                  {t('minAlreadyUsed').replace('{qty}', fmtU(editUsed))}
                </div>
              )}

              {/* Note */}
              <div className="field2" style={{ marginBottom: 14 }}>
                <div className="lbl">{t('note')}</div>
                <div className="inputBox" style={{ padding: 0 }}>
                  <textarea
                    value={editNote}
                    onChange={(e) => setEditNote(e.target.value)}
                    rows={2}
                    style={{ width: '100%', padding: '7px 10px', resize: 'none', background: 'transparent', border: 'none', color: 'var(--text)', fontSize: 12, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }}
                  />
                </div>
              </div>

              {/* Batch stats pills */}
              {editBatch && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 18 }}>
                  <span style={{ padding: '4px 10px', borderRadius: 999, border: '1px solid var(--line)', background: 'rgba(255,255,255,.03)', fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>
                    {t('remaining')} <strong style={{ color: 'var(--text)' }}>{fmtU(editRemaining)}</strong>
                  </span>
                  <span style={{ padding: '4px 10px', borderRadius: 999, border: '1px solid var(--line)', background: 'rgba(255,255,255,.03)', fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>
                    {t('usedLabel')} <strong style={{ color: 'var(--text)' }}>{fmtU(editUsed)}</strong>
                  </span>
                  <span style={{ padding: '4px 10px', borderRadius: 999, border: `1px solid color-mix(in srgb, ${editProfit >= 0 ? 'var(--good)' : 'var(--bad)'} 30%, transparent)`, background: `color-mix(in srgb, ${editProfit >= 0 ? 'var(--good)' : 'var(--bad)'} 10%, transparent)`, fontSize: 11, color: editProfit >= 0 ? 'var(--good)' : 'var(--bad)', fontWeight: 700 }}>
                    {t('profitLabel')} {editProfit >= 0 ? '+' : ''}{fmtQ(editProfit)}
                  </span>
                  <span style={{ padding: '4px 10px', borderRadius: 999, border: '1px solid var(--line)', background: 'rgba(255,255,255,.03)', fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>
                    {t('investedLabel')} <strong style={{ color: 'var(--text)' }}>{fmtQ(editInvested)}</strong>
                  </span>
                </div>
              )}

              <DialogFooter style={{ gap: 8, flexDirection: isMobile ? 'column' : 'row', justifyContent: 'space-between', alignItems: isMobile ? 'stretch' : 'center', position: isMobile ? 'sticky' : 'static', bottom: isMobile ? 0 : undefined, background: isMobile ? 'linear-gradient(to top, var(--bg) 75%, transparent)' : undefined, paddingTop: isMobile ? 8 : 0 }}>
                <button className="btn secondary" style={{ minWidth: 72 }} onClick={() => setEditingBatchId(null)}>{t('cancel')}</button>
                <div style={{ display: 'flex', gap: 8, width: isMobile ? '100%' : undefined }}>
                  <button
                    onClick={deleteBatch}
                    style={{ padding: '8px 14px', minHeight: isMobile ? 40 : undefined, flex: isMobile ? 1 : undefined, borderRadius: 6, background: 'color-mix(in srgb, var(--bad) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--bad) 30%, transparent)', color: 'var(--bad)', fontWeight: 600, fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                    {t('deleteBatch')}
                  </button>
                  <button
                    onClick={saveBatchEdit}
                    style={{ padding: '8px 18px', minHeight: isMobile ? 40 : undefined, flex: isMobile ? 1 : undefined, borderRadius: 6, background: 'var(--good)', color: '#000', fontWeight: 700, fontSize: 12, border: 'none', cursor: 'pointer' }}
                  >
                    {t('saveChanges')}
                  </button>
                </div>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        );
      })()}
    </div>
  );
}
