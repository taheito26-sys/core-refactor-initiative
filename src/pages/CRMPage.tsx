import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTrackerState } from '@/lib/useTrackerState';
import { fmtU, fmtDate, uid, type Customer } from '@/lib/tracker-helpers';
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
        {/* header */}
        <div className="panel-head" style={{ padding: '10px 16px' }}>
          <h2 style={{ fontSize: 13 }}>{title}</h2>
          <button className="rowBtn" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {/* body */}
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

// ── Label + input wrapper — also outside ─────────────────────────────
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

// ── Page ─────────────────────────────────────────────────────────────
export default function CRMPage() {
  const { settings } = useTheme();
  const t = useT();
  const navigate = useNavigate();
  const { state, applyState } = useTrackerState({
    lowStockThreshold: settings.lowStockThreshold,
    priceAlertThreshold: settings.priceAlertThreshold,
  });

  const [tab, setTab] = useState<'customers' | 'suppliers'>('customers');
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
    const map = new Map<string, { name: string; batchCount: number; totalUSDT: number; lastDate: number }>();
    for (const b of state.batches) {
      const src = b.source.trim();
      if (!src) continue;
      const ex = map.get(src);
      if (ex) { ex.batchCount++; ex.totalUSDT += b.initialUSDT; ex.lastDate = Math.max(ex.lastDate, b.ts); }
      else map.set(src, { name: src, batchCount: 1, totalUSDT: b.initialUSDT, lastDate: b.ts });
    }
    return Array.from(map.values()).sort((a, b) => b.lastDate - a.lastDate);
  }, [state.batches]);

  const filteredSuppliers = useMemo(() => {
    if (!search) return suppliers;
    const q = search.toLowerCase();
    return suppliers.filter(s => s.name.toLowerCase().includes(q));
  }, [suppliers, search]);

  const customerStats = (cId: string) => {
    const trades = state.trades.filter(tr => !tr.voided && tr.customerId === cId);
    return {
      trades: trades.length,
      totalUSDT: trades.reduce((s, tr) => s + tr.amountUSDT, 0),
      totalQAR:  trades.reduce((s, tr) => s + tr.amountUSDT * tr.sellPriceQAR, 0),
    };
  };

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
    // Create a zero-amount batch to register the supplier
    const newBatch = {
      id: uid(), ts: Date.now(), source: name,
      initialUSDT: 0, remainingUSDT: 0,
      costPerUnit: 0, sold: 0, voided: false,
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

  // ── Render ────────────────────────────────────────────────────────
  return (
    <div className="tracker-root" dir={t.isRTL ? 'rtl' : 'ltr'}
      style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10, minHeight: '100%' }}>

      {/* Tab bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 4 }}>
          <button className={`btn ${tab === 'customers' ? '' : 'secondary'}`} onClick={() => setTab('customers')}>
            👥 {t('customers')} ({customers.length})
          </button>
          <button className={`btn ${tab === 'suppliers' ? '' : 'secondary'}`} onClick={() => setTab('suppliers')}>
            📦 {t('suppliers')} ({suppliers.length})
          </button>
        </div>
        <div className="inputBox" style={{ maxWidth: 260, padding: '6px 10px' }}>
          <input
            placeholder={tab === 'customers' ? t('searchCustomers') : t('searchSuppliers')}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* ── CUSTOMERS ── */}
      {tab === 'customers' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
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
                    <th>{t('name')}</th><th>{t('phone')}</th><th>{t('tier')}</th>
                    <th className="r">{t('dailyLimit')}</th><th className="r">{t('trades')}</th>
                    <th className="r">{t('totalUsdt')}</th><th className="r">{t('totalQar')}</th>
                    <th>{t('notes')}</th><th>{t('actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCustomers.map(c => {
                    const s = customerStats(c.id);
                    return (
                      <tr key={c.id}>
                        <td style={{ fontWeight: 700 }}>{c.name}</td>
                        <td className="mono">{c.phone || '—'}</td>
                        <td>
                          <span className={`pill ${c.tier === 'A' ? 'good' : c.tier === 'B' ? 'warn' : ''}`}>{c.tier}</span>
                        </td>
                        <td className="mono r">{fmtU(c.dailyLimitUSDT, 0)}</td>
                        <td className="mono r">{s.trades}</td>
                        <td className="mono r">{fmtU(s.totalUSDT, 0)}</td>
                        <td className="mono r">{fmtU(s.totalQAR, 0)}</td>
                        <td style={{ fontSize: 10, color: 'var(--muted)', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.notes || '—'}</td>
                        <td>
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button className="rowBtn" onClick={() => openEditCustomer(c)}>{t('edit')}</button>
                            <button className="rowBtn" onClick={() => navigate('/trading/orders')}>{t('history')}</button>
                            <button className="rowBtn" style={{ color: 'var(--bad)' }} onClick={() => deleteCustomer(c.id)}>✕</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ── SUPPLIERS ── */}
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
            <div className="tableWrap">
              <table>
                <thead>
                  <tr>
                    <th>{t('supplier')}</th><th className="r">{t('batches')}</th>
                    <th className="r">{t('totalUsdt')}</th><th>{t('lastPurchase')}</th><th>{t('actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSuppliers.map(s => (
                    <tr key={s.name}>
                      <td style={{ fontWeight: 700 }}>{s.name}</td>
                      <td className="mono r">{s.batchCount}</td>
                      <td className="mono r">{fmtU(s.totalUSDT, 0)}</td>
                      <td className="mono">{fmtDate(s.lastDate)}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button className="rowBtn" onClick={() => navigate('/trading/stock')}>{t('viewBatches')}</button>
                          <button className="rowBtn" onClick={() => openEditSupplier(s.name)}>{t('edit')}</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
    </div>
  );
}
