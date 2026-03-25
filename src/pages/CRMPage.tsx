import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTrackerState } from '@/lib/useTrackerState';
import { fmtU, fmtDate, fmtTotal, fmtPrice, uid, type Customer } from '@/lib/tracker-helpers';
import { useTheme } from '@/lib/theme-context';
import { useT } from '@/lib/i18n';
import '@/styles/tracker.css';

// ── Blank customer factory ────────────────────────────────────────────
const blankCustomer = (): Omit<Customer, 'id' | 'createdAt'> => ({
  name: '', phone: '', tier: 'C', dailyLimitUSDT: 0, notes: '',
});

// ── Modal wrapper — defined OUTSIDE the page so React never remounts it ──
function CRMModal({
  title, onClose, onSave, error, children,
}: {
  title: string;
  onClose: () => void;
  onSave: () => void;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.50)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
      onClick={onClose}
    >
      <div
        className="panel"
        style={{ width: '100%', maxWidth: 460, borderRadius: 12, overflow: 'hidden' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="panel-head" style={{ padding: '10px 16px' }}>
          <h2 style={{ fontSize: 13 }}>{title}</h2>
          <button className="rowBtn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {children}
          {error && (
            <div style={{ fontSize: 11, color: 'var(--bad)', paddingTop: 2 }}>⚠ {error}</div>
          )}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
            <button className="btn secondary" onClick={onClose}>Cancel</button>
            <button className="btn" onClick={onSave}>Save</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted)' }}>
        {label}
      </label>
      {children}
    </div>
  );
}

// ── KPI Card ────────────────────────────────────────────────────────
function KpiCard({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div style={{
      flex: '1 1 120px', minWidth: 100, padding: '8px 12px',
      border: '1px solid var(--line)', borderRadius: 8,
      background: 'var(--surface)',
    }}>
      <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted)' }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, fontFamily: 'var(--mono, monospace)', color: color || 'var(--fg)', marginTop: 2 }}>{value}</div>
    </div>
  );
}

// ── Supplier Detail Card ────────────────────────────────────────────
function SupplierCard({ supplier, maxUSDT, onEdit, onDelete }: {
  supplier: { name: string; batchCount: number; totalUSDT: number; avgCost: number; spentQAR: number; lastDate: number; volumePct: number };
  maxUSDT: number;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const pct = maxUSDT > 0 ? Math.round((supplier.totalUSDT / maxUSDT) * 100) : 0;
  return (
    <div style={{
      border: '1px solid var(--line)', borderRadius: 10, padding: 14,
      background: 'var(--surface)', display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 14, fontWeight: 800 }}>{supplier.name}</div>
        <span className="pill" style={{ fontSize: 10 }}>{supplier.batchCount} {supplier.batchCount === 1 ? 'batch' : 'batches'}</span>
      </div>
      
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
        <div style={{ textAlign: 'center', padding: '6px 4px', background: 'color-mix(in srgb, var(--fg) 5%, transparent)', borderRadius: 6 }}>
          <div style={{ fontSize: 8, fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted)', letterSpacing: '0.06em' }}>USDT</div>
          <div style={{ fontSize: 14, fontWeight: 800, fontFamily: 'var(--mono, monospace)' }}>{fmtTotal(supplier.totalUSDT)}</div>
        </div>
        <div style={{ textAlign: 'center', padding: '6px 4px', background: 'color-mix(in srgb, var(--fg) 5%, transparent)', borderRadius: 6 }}>
          <div style={{ fontSize: 8, fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted)', letterSpacing: '0.06em' }}>AVG/USDT</div>
          <div style={{ fontSize: 14, fontWeight: 800, fontFamily: 'var(--mono, monospace)' }}>{fmtPrice(supplier.avgCost)}</div>
        </div>
        <div style={{ textAlign: 'center', padding: '6px 4px', background: 'color-mix(in srgb, var(--fg) 5%, transparent)', borderRadius: 6 }}>
          <div style={{ fontSize: 8, fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted)', letterSpacing: '0.06em' }}>SPENT QAR</div>
          <div style={{ fontSize: 14, fontWeight: 800, fontFamily: 'var(--mono, monospace)' }}>{fmtTotal(supplier.spentQAR)}</div>
        </div>
      </div>

      <div style={{ fontSize: 10, color: 'var(--muted)' }}>Last supply: {fmtDate(supplier.lastDate)}</div>
      
      {/* Volume progress bar */}
      <div>
        <div style={{ height: 5, borderRadius: 3, background: 'color-mix(in srgb, var(--good) 15%, transparent)', overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${pct}%`, background: 'var(--good)', borderRadius: 3, transition: 'width 0.3s' }} />
        </div>
        <div style={{ fontSize: 9, color: 'var(--muted)', marginTop: 3 }}>{pct}% of total supply volume</div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <button className="rowBtn" onClick={onEdit} style={{ fontSize: 11 }}>Edit</button>
        <button className="rowBtn" onClick={onDelete} style={{ fontSize: 11, color: 'var(--bad)', border: '1px solid var(--bad)', borderRadius: 4, padding: '2px 10px' }}>Delete</button>
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────
export default function CRMPage() {
  const { settings } = useTheme();
  const t = useT();
  const navigate = useNavigate();
  const { state, applyState } = useTrackerState({
    lowStockThreshold: settings.lowStockThreshold,
    priceAlertThreshold: settings.priceAlertThreshold,
  });

  const [tab, setTab] = useState<'pipeline' | 'list' | 'suppliers'>('pipeline');
  const [search, setSearch] = useState('');

  // ── Customer modal ────────────────────────────────────────────────
  const [showCustModal, setShowCustModal] = useState(false);
  const [editingCust, setEditingCust] = useState<Customer | null>(null);
  const [custForm, setCustForm] = useState(blankCustomer());
  const [custError, setCustError] = useState('');

  // ── Supplier rename modal ─────────────────────────────────────────
  const [showSuppModal, setShowSuppModal] = useState(false);
  const [editingSupp, setEditingSupp] = useState('');
  const [suppName, setSuppName] = useState('');
  const [suppError, setSuppError] = useState('');

  // ── Supplier add modal ────────────────────────────────────────────
  const [showAddSuppModal, setShowAddSuppModal] = useState(false);
  const [newSuppName, setNewSuppName] = useState('');
  const [newSuppError, setNewSuppError] = useState('');

  // ── Derived lists ─────────────────────────────────────────────────
  const customers = state.customers ?? [];

  const filteredCustomers = useMemo(() => {
    if (!search) return customers;
    const q = search.toLowerCase();
    return customers.filter(c =>
      c.name.toLowerCase().includes(q) || c.phone.includes(q),
    );
  }, [customers, search]);

  const suppliers = useMemo(() => {
    const map = new Map<string, { name: string; batchCount: number; totalUSDT: number; avgCost: number; spentQAR: number; lastDate: number; volumePct: number }>();
    let grandTotal = 0;
    for (const b of state.batches) {
      const src = b.source.trim();
      if (!src) continue;
      const cost = b.initialUSDT * b.buyPriceQAR;
      const ex = map.get(src);
      if (ex) {
        ex.batchCount++;
        ex.totalUSDT += b.initialUSDT;
        ex.spentQAR += cost;
        ex.lastDate = Math.max(ex.lastDate, b.ts);
      } else {
        map.set(src, { name: src, batchCount: 1, totalUSDT: b.initialUSDT, avgCost: 0, spentQAR: cost, lastDate: b.ts, volumePct: 0 });
      }
      grandTotal += b.initialUSDT;
    }
    const arr = Array.from(map.values());
    for (const s of arr) {
      s.avgCost = s.totalUSDT > 0 ? s.spentQAR / s.totalUSDT : 0;
      s.volumePct = grandTotal > 0 ? (s.totalUSDT / grandTotal) * 100 : 0;
    }
    return arr.sort((a, b) => b.totalUSDT - a.totalUSDT);
  }, [state.batches]);

  const filteredSuppliers = useMemo(() => {
    if (!search) return suppliers;
    const q = search.toLowerCase();
    return suppliers.filter(s => s.name.toLowerCase().includes(q));
  }, [suppliers, search]);

  // ── Stats ─────────────────────────────────────────────────────────
  const customerStats = (cId: string) => {
    const trades = state.trades.filter(tr => !tr.voided && tr.customerId === cId);
    const totalUSDT = trades.reduce((s, tr) => s + tr.amountUSDT, 0);
    const totalRevenue = trades.reduce((s, tr) => s + tr.amountUSDT * tr.sellPriceQAR, 0);
    // Simple P&L: revenue - cost (using FIFO cost basis approximation)
    const totalCost = trades.reduce((s, tr) => {
      // If trade uses stock, approximate cost from batches avg
      const avgBuyCost = state.batches.length > 0
        ? state.batches.reduce((a, b) => a + b.buyPriceQAR * b.initialUSDT, 0) / Math.max(1, state.batches.reduce((a, b) => a + b.initialUSDT, 0))
        : 0;
      return s + tr.amountUSDT * avgBuyCost;
    }, 0);
    const pnl = totalRevenue - totalCost;
    const lastTrade = trades.length > 0 ? Math.max(...trades.map(tr => tr.ts)) : 0;
    return { trades: trades.length, totalUSDT, totalQAR: totalRevenue, pnl, lastTrade };
  };

  const kpis = useMemo(() => {
    const allTrades = state.trades.filter(tr => !tr.voided);
    const totalUSDT = allTrades.reduce((s, tr) => s + tr.amountUSDT, 0);
    const totalRevenue = allTrades.reduce((s, tr) => s + tr.amountUSDT * tr.sellPriceQAR, 0);
    const avgBuyCost = state.batches.length > 0
      ? state.batches.reduce((a, b) => a + b.buyPriceQAR * b.initialUSDT, 0) / Math.max(1, state.batches.reduce((a, b) => a + b.initialUSDT, 0))
      : 0;
    const totalCost = allTrades.reduce((s, tr) => s + tr.amountUSDT * avgBuyCost, 0);
    const netPnl = totalRevenue - totalCost;
    const linkedTrades = allTrades.filter(tr => tr.linkedRelId).length;
    const tierCounts = { A: 0, B: 0, C: 0 };
    for (const c of customers) {
      if (c.tier === 'A') tierCounts.A++;
      else if (c.tier === 'B') tierCounts.B++;
      else tierCounts.C++;
    }
    return { clients: customers.length, totalUSDT, netPnl, linkedTrades, supplierCount: suppliers.length, tierCounts };
  }, [state.trades, state.batches, customers, suppliers]);

  const maxSupplierUSDT = useMemo(() => {
    return suppliers.reduce((max, s) => Math.max(max, s.totalUSDT), 0);
  }, [suppliers]);

  // ── Customer handlers ─────────────────────────────────────────────
  const openAddCustomer = () => {
    setEditingCust(null);
    setCustForm(blankCustomer());
    setCustError('');
    setShowCustModal(true);
  };

  const openEditCustomer = (c: Customer) => {
    setEditingCust(c);
    setCustForm({ name: c.name, phone: c.phone, tier: c.tier, dailyLimitUSDT: c.dailyLimitUSDT, notes: c.notes });
    setCustError('');
    setShowCustModal(true);
  };

  const saveCustomer = () => {
    if (!custForm.name.trim()) { setCustError('Name is required.'); return; }
    const existing = customers.find(
      c => c.name.toLowerCase() === custForm.name.trim().toLowerCase() && c.id !== editingCust?.id
    );
    if (existing) { setCustError('A customer with this name already exists.'); return; }

    const next = editingCust
      ? customers.map(c => c.id === editingCust.id ? { ...c, ...custForm, name: custForm.name.trim() } : c)
      : [...customers, { id: uid(), createdAt: Date.now(), ...custForm, name: custForm.name.trim() } as Customer];

    applyState({ ...state, customers: next });
    setShowCustModal(false);
  };

  const deleteCustomer = (id: string) => {
    if (!window.confirm('Delete this customer? This cannot be undone.')) return;
    applyState({ ...state, customers: customers.filter(c => c.id !== id) });
  };

  // ── Supplier handlers ─────────────────────────────────────────────
  const openEditSupplier = (name: string) => {
    setEditingSupp(name);
    setSuppName(name);
    setSuppError('');
    setShowSuppModal(true);
  };

  const openAddSupplier = () => {
    setNewSuppName('');
    setNewSuppError('');
    setShowAddSuppModal(true);
  };

  const saveNewSupplier = () => {
    const name = newSuppName.trim();
    if (!name) { setNewSuppError('Supplier name is required.'); return; }
    const exists = suppliers.some(s => s.name.toLowerCase() === name.toLowerCase());
    if (exists) { setNewSuppError('A supplier with this name already exists.'); return; }
    const newBatch = {
      id: uid(), ts: Date.now(), source: name,
      initialUSDT: 0, remainingUSDT: 0,
      costPerUnit: 0, sold: 0, voided: false,
      note: '', buyPriceQAR: 0, revisions: [],
    };
    applyState({ ...state, batches: [...state.batches, newBatch] });
    setShowAddSuppModal(false);
  };

  const saveSupplier = () => {
    if (!suppName.trim()) { setSuppError('Name is required.'); return; }
    if (suppName.trim() !== editingSupp) {
      applyState({
        ...state,
        batches: state.batches.map(b =>
          b.source.trim() === editingSupp ? { ...b, source: suppName.trim() } : b,
        ),
      });
    }
    setShowSuppModal(false);
  };

  const deleteSupplier = (name: string) => {
    if (!window.confirm(`Delete supplier "${name}" and all associated batches? This cannot be undone.`)) return;
    applyState({
      ...state,
      batches: state.batches.filter(b => b.source.trim() !== name),
    });
  };

  // ── Tab views (Pipeline = card view, List = table view) ───────────
  const isCustomerTab = tab === 'pipeline' || tab === 'list';

  // ── Render ────────────────────────────────────────────────────────
  return (
    <div className="tracker-root" dir={t.isRTL ? 'rtl' : 'ltr'}
      style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10, minHeight: '100%' }}>

      {/* ── KPI Stats Bar ── */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <KpiCard label="Clients" value={kpis.clients} />
        <KpiCard label="USDT Vol" value={fmtTotal(kpis.totalUSDT)} />
        <KpiCard label="Net P&L" value={(kpis.netPnl >= 0 ? '+' : '') + fmtTotal(kpis.netPnl)} color={kpis.netPnl >= 0 ? 'var(--good)' : 'var(--bad)'} />
        <KpiCard label="Linked Trades" value={kpis.linkedTrades} />
        <KpiCard label="Suppliers" value={kpis.supplierCount} />
        <KpiCard label="⭐ A" value={kpis.tierCounts.A} color="var(--good)" />
        <KpiCard label="🔵 B" value={kpis.tierCounts.B} color="hsl(210 80% 60%)" />
        <KpiCard label="🔴 C" value={kpis.tierCounts.C} color="var(--bad)" />
      </div>

      {/* Tab bar + search */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 4 }}>
          <button className={`btn ${tab === 'pipeline' ? '' : 'secondary'}`} onClick={() => setTab('pipeline')}>
            📊 Pipeline
          </button>
          <button className={`btn ${tab === 'list' ? '' : 'secondary'}`} onClick={() => setTab('list')}>
            ≡ List
          </button>
          <button className={`btn ${tab === 'suppliers' ? '' : 'secondary'}`} onClick={() => setTab('suppliers')}
            style={tab === 'suppliers' ? { background: 'var(--good)', color: '#000' } : {}}>
            📦 Suppliers
          </button>
        </div>
        <div className="inputBox" style={{ maxWidth: 260, padding: '6px 10px' }}>
          <input
            placeholder={isCustomerTab ? t('searchCustomers') : t('searchSuppliers')}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* ── CUSTOMERS (Pipeline or List) ── */}
      {isCustomerTab && (
        <div style={{ display: 'flex', gap: 12, flex: 1, minHeight: 0 }}>
          {/* Main table area */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 800 }}>{t('customers')}</div>
                <div style={{ fontSize: 10, color: 'var(--muted)' }}>{t('buyerManagement')}</div>
              </div>
              <button className="btn" onClick={openAddCustomer}>{t('addCustomer')}</button>
            </div>

            {filteredCustomers.length === 0 ? (
              <div className="empty">
                <div className="empty-t">{t('noCustomersFound')}</div>
                <div className="empty-s">{t('addFirstBuyer')}</div>
              </div>
            ) : (
              <div className="tableWrap">
                <table>
                  <thead>
                    <tr>
                      <th>{t('name')}</th>
                      <th>Tier</th>
                      <th className="r">{t('trades')}</th>
                      <th className="r">USDT Vol</th>
                      <th className="r">Net P&L</th>
                      <th>Last Trade</th>
                      <th>{t('actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCustomers.map(c => {
                      const s = customerStats(c.id);
                      return (
                        <tr key={c.id}>
                          <td style={{ fontWeight: 700 }}>{c.name}</td>
                          <td>
                            <span className={`pill ${c.tier === 'A' ? 'good' : c.tier === 'B' ? 'warn' : ''}`}
                              style={{
                                fontWeight: 700, fontSize: 10, minWidth: 28, textAlign: 'center',
                                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 3,
                              }}>
                              {c.tier === 'A' ? '⭐' : c.tier === 'B' ? '＋' : '●'} {c.tier}
                            </span>
                          </td>
                          <td className="mono r">{s.trades}</td>
                          <td className="mono r">{fmtTotal(s.totalUSDT)}</td>
                          <td className="mono r" style={{ color: s.pnl >= 0 ? 'var(--good)' : 'var(--bad)', fontWeight: 700 }}>
                            {s.pnl >= 0 ? '+' : ''}{fmtTotal(s.pnl)}
                          </td>
                          <td className="mono" style={{ fontSize: 10, color: 'var(--muted)' }}>
                            {s.lastTrade > 0 ? fmtDate(s.lastTrade) : '—'}
                          </td>
                          <td>
                            <div style={{ display: 'flex', gap: 4 }}>
                              <button className="rowBtn" onClick={() => openEditCustomer(c)}>Edit</button>
                              <button className="rowBtn" style={{ color: 'var(--bad)', fontWeight: 700, fontSize: 14, lineHeight: 1, padding: '2px 6px', border: '1px solid var(--bad)', borderRadius: 4 }} onClick={() => deleteCustomer(c.id)}>✕</button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Right side: Supplier summary panel (visible only in pipeline view) */}
          {tab === 'pipeline' && suppliers.length > 0 && (
            <div style={{
              width: 320, minWidth: 280, flexShrink: 0,
              display: 'flex', flexDirection: 'column', gap: 8,
              overflowY: 'auto', maxHeight: 'calc(100vh - 220px)',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontSize: 13, fontWeight: 800 }}>📦 Suppliers</div>
                <span className="pill" style={{ fontSize: 10 }}>Full</span>
              </div>
              {suppliers.slice(0, 10).map(s => (
                <SupplierCard
                  key={s.name}
                  supplier={s}
                  maxUSDT={maxSupplierUSDT}
                  onEdit={() => openEditSupplier(s.name)}
                  onDelete={() => deleteSupplier(s.name)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── SUPPLIERS TAB ── */}
      {tab === 'suppliers' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 800 }}>{t('suppliers')}</div>
              <div style={{ fontSize: 10, color: 'var(--muted)' }}>{t('autoTrackedFromBatches')}</div>
            </div>
            <button className="btn" onClick={openAddSupplier}>+ {t('addSupplier')}</button>
          </div>

          <div style={{ fontSize: 11, color: 'var(--muted)', background: 'color-mix(in srgb, var(--warn) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--warn) 25%, transparent)', borderRadius: 8, padding: '8px 12px' }}>
            💡 Suppliers are auto-tracked from batch source names in Stock, or you can add them directly here.
          </div>

          {filteredSuppliers.length === 0 ? (
            <div className="empty">
              <div className="empty-t">{t('noSuppliersFound')}</div>
              <div className="empty-s">{t('addBatchesToTrack')}</div>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
              {filteredSuppliers.map(s => (
                <SupplierCard
                  key={s.name}
                  supplier={s}
                  maxUSDT={maxSupplierUSDT}
                  onEdit={() => openEditSupplier(s.name)}
                  onDelete={() => deleteSupplier(s.name)}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* ── Customer Add/Edit Modal ── */}
      {showCustModal && (
        <CRMModal
          title={editingCust ? `Edit — ${editingCust.name}` : t('addCustomer')}
          onClose={() => setShowCustModal(false)}
          onSave={saveCustomer}
          error={custError}
        >
          <FormField label="Name *">
            <input
              className="inputBox"
              style={{ padding: '6px 10px', width: '100%' }}
              placeholder="e.g. Ahmed Al-Rashid"
              value={custForm.name}
              autoFocus
              onChange={e => setCustForm(f => ({ ...f, name: e.target.value }))}
            />
          </FormField>
          <FormField label="Phone">
            <input
              className="inputBox"
              style={{ padding: '6px 10px', width: '100%' }}
              placeholder="+974 ..."
              value={custForm.phone}
              onChange={e => setCustForm(f => ({ ...f, phone: e.target.value }))}
            />
          </FormField>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <FormField label="Tier">
              <select
                style={{ padding: '6px 10px', width: '100%', background: 'var(--surface)', color: 'var(--fg)', border: '1px solid var(--line)', borderRadius: 6, fontSize: 12 }}
                value={custForm.tier}
                onChange={e => setCustForm(f => ({ ...f, tier: e.target.value }))}
              >
                <option value="A">A — VIP</option>
                <option value="B">B — Regular</option>
                <option value="C">C — New</option>
              </select>
            </FormField>
            <FormField label="Daily Limit (USDT)">
              <input
                className="inputBox"
                style={{ padding: '6px 10px', width: '100%' }}
                type="number"
                min={0}
                placeholder="0"
                value={custForm.dailyLimitUSDT || ''}
                onChange={e => setCustForm(f => ({ ...f, dailyLimitUSDT: parseFloat(e.target.value) || 0 }))}
              />
            </FormField>
          </div>
          <FormField label="Notes">
            <textarea
              style={{ padding: '6px 10px', width: '100%', background: 'var(--surface)', color: 'var(--fg)', border: '1px solid var(--line)', borderRadius: 6, fontSize: 12, resize: 'vertical', minHeight: 64, fontFamily: 'inherit' }}
              placeholder="Optional notes..."
              value={custForm.notes}
              onChange={e => setCustForm(f => ({ ...f, notes: e.target.value }))}
            />
          </FormField>
        </CRMModal>
      )}

      {/* ── Supplier Rename Modal ── */}
      {showSuppModal && (
        <CRMModal
          title={`Rename Supplier — ${editingSupp}`}
          onClose={() => setShowSuppModal(false)}
          onSave={saveSupplier}
          error={suppError}
        >
          <FormField label="Supplier Name *">
            <input
              className="inputBox"
              style={{ padding: '6px 10px', width: '100%' }}
              placeholder="Supplier name"
              value={suppName}
              autoFocus
              onChange={e => setSuppName(e.target.value)}
            />
          </FormField>
          <div style={{ fontSize: 10, color: 'var(--muted)' }}>
            This renames the supplier across all batches that reference this name.
          </div>
        </CRMModal>
      )}

      {/* ── Add Supplier Modal ── */}
      {showAddSuppModal && (
        <CRMModal
          title="Add Supplier"
          onClose={() => setShowAddSuppModal(false)}
          onSave={saveNewSupplier}
          error={newSuppError}
        >
          <FormField label="Supplier Name *">
            <input
              className="inputBox"
              style={{ padding: '6px 10px', width: '100%' }}
              placeholder="e.g. Al-Fardan Exchange"
              value={newSuppName}
              autoFocus
              onChange={e => setNewSuppName(e.target.value)}
            />
          </FormField>
          <div style={{ fontSize: 10, color: 'var(--muted)' }}>
            The supplier will appear in your list. You can attach batches to them later from the Stock page.
          </div>
        </CRMModal>
      )}
    </div>
  );
}
