import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTrackerState } from '@/lib/useTrackerState';
import { fmtU, fmtDate, uid, type Customer } from '@/lib/tracker-helpers';
import { useTheme } from '@/lib/theme-context';
import { useT } from '@/lib/i18n';
import '@/styles/tracker.css';

// ── blank customer form ───────────────────────────────────────────────
const BLANK_CUSTOMER = (): Omit<Customer, 'id' | 'createdAt'> => ({
  name: '',
  phone: '',
  tier: 'C',
  dailyLimitUSDT: 0,
  notes: '',
});

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

  // ── customer modal state ─────────────────────────────────────────
  const [showCustomerModal, setShowCustomerModal] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [customerForm, setCustomerForm] = useState(BLANK_CUSTOMER());
  const [customerError, setCustomerError] = useState('');

  // ── supplier rename modal state ──────────────────────────────────
  const [showSupplierModal, setShowSupplierModal] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<string | null>(null);
  const [supplierName, setSupplierName] = useState('');
  const [supplierError, setSupplierError] = useState('');

  // ── derived data ─────────────────────────────────────────────────
  const customers = state.customers;
  const filteredCustomers = !search
    ? customers
    : customers.filter(c =>
        c.name.toLowerCase().includes(search.toLowerCase()) ||
        c.phone.includes(search),
      );

  const supplierMap = new Map<string, { name: string; batchCount: number; totalUSDT: number; lastDate: number }>();
  for (const b of state.batches) {
    const src = b.source.trim();
    if (!src) continue;
    const existing = supplierMap.get(src);
    if (existing) {
      existing.batchCount++;
      existing.totalUSDT += b.initialUSDT;
      existing.lastDate = Math.max(existing.lastDate, b.ts);
    } else {
      supplierMap.set(src, { name: src, batchCount: 1, totalUSDT: b.initialUSDT, lastDate: b.ts });
    }
  }
  const suppliers = Array.from(supplierMap.values()).sort((a, b) => b.lastDate - a.lastDate);
  const filteredSuppliers = !search
    ? suppliers
    : suppliers.filter(s => s.name.toLowerCase().includes(search.toLowerCase()));

  const customerStats = (cId: string) => {
    const trades = state.trades.filter(tr => !tr.voided && tr.customerId === cId);
    const totalUSDT = trades.reduce((s, tr) => s + tr.amountUSDT, 0);
    const totalQAR = trades.reduce((s, tr) => s + tr.amountUSDT * tr.sellPriceQAR, 0);
    return { trades: trades.length, totalUSDT, totalQAR };
  };

  // ── customer handlers ────────────────────────────────────────────
  const openAddCustomer = () => {
    setEditingCustomer(null);
    setCustomerForm(BLANK_CUSTOMER());
    setCustomerError('');
    setShowCustomerModal(true);
  };

  const openEditCustomer = (c: Customer) => {
    setEditingCustomer(c);
    setCustomerForm({ name: c.name, phone: c.phone, tier: c.tier, dailyLimitUSDT: c.dailyLimitUSDT, notes: c.notes });
    setCustomerError('');
    setShowCustomerModal(true);
  };

  const saveCustomer = () => {
    if (!customerForm.name.trim()) { setCustomerError('Name is required.'); return; }

    let nextCustomers: Customer[];
    if (editingCustomer) {
      nextCustomers = state.customers.map(c =>
        c.id === editingCustomer.id
          ? { ...c, ...customerForm, name: customerForm.name.trim() }
          : c,
      );
    } else {
      const newCustomer: Customer = {
        id: uid(),
        createdAt: Date.now(),
        ...customerForm,
        name: customerForm.name.trim(),
      };
      nextCustomers = [...state.customers, newCustomer];
    }

    applyState({ ...state, customers: nextCustomers });
    setShowCustomerModal(false);
  };

  const deleteCustomer = (id: string) => {
    if (!window.confirm('Delete this customer?')) return;
    applyState({ ...state, customers: state.customers.filter(c => c.id !== id) });
  };

  // ── supplier handlers ────────────────────────────────────────────
  const openEditSupplier = (name: string) => {
    setEditingSupplier(name);
    setSupplierName(name);
    setSupplierError('');
    setShowSupplierModal(true);
  };

  const saveSupplier = () => {
    if (!supplierName.trim()) { setSupplierError('Name is required.'); return; }
    if (editingSupplier && supplierName.trim() !== editingSupplier) {
      // Rename the source across all matching batches
      const updatedBatches = state.batches.map(b =>
        b.source.trim() === editingSupplier ? { ...b, source: supplierName.trim() } : b,
      );
      applyState({ ...state, batches: updatedBatches });
    }
    setShowSupplierModal(false);
  };

  // ── overlay modal component ──────────────────────────────────────
  const Modal = ({ title, onClose, onSave, children, error }: {
    title: string;
    onClose: () => void;
    onSave: () => void;
    children: React.ReactNode;
    error?: string;
  }) => (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
      onClick={onClose}
    >
      <div
        className="panel"
        style={{ width: '100%', maxWidth: 440, borderRadius: 12, overflow: 'hidden' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="panel-head" style={{ padding: '10px 16px' }}>
          <h2 style={{ fontSize: 13 }}>{title}</h2>
          <button className="rowBtn" onClick={onClose}>✕</button>
        </div>
        <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {children}
          {error && <div style={{ fontSize: 11, color: 'var(--bad)' }}>⚠ {error}</div>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
            <button className="btn secondary" onClick={onClose}>{t('cancel')}</button>
            <button className="btn" onClick={onSave}>{t('save')}</button>
          </div>
        </div>
      </div>
    </div>
  );

  const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted)' }}>{label}</label>
      {children}
    </div>
  );

  return (
    <div className="tracker-root" dir={t.isRTL ? 'rtl' : 'ltr'} style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10, minHeight: '100%' }}>

      {/* ── Tab toggle ── */}
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

      {/* ── CUSTOMERS TAB ── */}
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
                    <th>{t('name')}</th>
                    <th>{t('phone')}</th>
                    <th>{t('tier')}</th>
                    <th className="r">{t('dailyLimit')}</th>
                    <th className="r">{t('trades')}</th>
                    <th className="r">{t('totalUsdt')}</th>
                    <th className="r">{t('totalQar')}</th>
                    <th>{t('notes')}</th>
                    <th>{t('actions')}</th>
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

      {/* ── SUPPLIERS TAB ── */}
      {tab === 'suppliers' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 800 }}>{t('suppliers')}</div>
              <div style={{ fontSize: 10, color: 'var(--muted)' }}>{t('autoTrackedFromBatches')}</div>
            </div>
            <button className="btn" onClick={() => navigate('/trading/stock')}>
              {t('addSupplier')}
            </button>
          </div>

          {/* Info banner explaining how suppliers work */}
          <div style={{ fontSize: 11, color: 'var(--muted)', background: 'color-mix(in srgb, var(--warn) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--warn) 30%, transparent)', borderRadius: 8, padding: '8px 12px' }}>
            💡 Suppliers are automatically tracked from your stock batches. Click <strong>+ Add Supplier</strong> to go to Stock and create a new batch — the supplier name will appear here automatically.
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
                    <th>{t('supplier')}</th>
                    <th className="r">{t('batches')}</th>
                    <th className="r">{t('totalUsdt')}</th>
                    <th>{t('lastPurchase')}</th>
                    <th>{t('actions')}</th>
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

      {/* ── Customer Modal ── */}
      {showCustomerModal && (
        <Modal
          title={editingCustomer ? `Edit — ${editingCustomer.name}` : t('addCustomer')}
          onClose={() => setShowCustomerModal(false)}
          onSave={saveCustomer}
          error={customerError}
        >
          <Field label={t('name') + ' *'}>
            <input
              className="inputBox"
              style={{ padding: '6px 10px' }}
              placeholder="e.g. Ahmed Al-Rashid"
              value={customerForm.name}
              onChange={e => setCustomerForm(f => ({ ...f, name: e.target.value }))}
              autoFocus
            />
          </Field>
          <Field label={t('phone')}>
            <input
              className="inputBox"
              style={{ padding: '6px 10px' }}
              placeholder="+974 ..."
              value={customerForm.phone}
              onChange={e => setCustomerForm(f => ({ ...f, phone: e.target.value }))}
            />
          </Field>
          <Field label={t('tier')}>
            <select
              className="inputBox"
              style={{ padding: '6px 10px' }}
              value={customerForm.tier}
              onChange={e => setCustomerForm(f => ({ ...f, tier: e.target.value }))}
            >
              <option value="A">A — VIP</option>
              <option value="B">B — Regular</option>
              <option value="C">C — New</option>
            </select>
          </Field>
          <Field label={t('dailyLimit') + ' (USDT)'}>
            <input
              className="inputBox"
              style={{ padding: '6px 10px' }}
              type="number"
              min={0}
              placeholder="0"
              value={customerForm.dailyLimitUSDT || ''}
              onChange={e => setCustomerForm(f => ({ ...f, dailyLimitUSDT: parseFloat(e.target.value) || 0 }))}
            />
          </Field>
          <Field label={t('notes')}>
            <textarea
              className="inputBox"
              style={{ padding: '6px 10px', resize: 'vertical', minHeight: 60 }}
              placeholder="Optional notes..."
              value={customerForm.notes}
              onChange={e => setCustomerForm(f => ({ ...f, notes: e.target.value }))}
            />
          </Field>
        </Modal>
      )}

      {/* ── Supplier Rename Modal ── */}
      {showSupplierModal && (
        <Modal
          title={`Rename Supplier — ${editingSupplier}`}
          onClose={() => setShowSupplierModal(false)}
          onSave={saveSupplier}
          error={supplierError}
        >
          <Field label="Supplier Name *">
            <input
              className="inputBox"
              style={{ padding: '6px 10px' }}
              placeholder="Supplier name"
              value={supplierName}
              onChange={e => setSupplierName(e.target.value)}
              autoFocus
            />
          </Field>
          <div style={{ fontSize: 10, color: 'var(--muted)' }}>
            This will rename the supplier across all batches that reference this name.
          </div>
        </Modal>
      )}
    </div>
  );
}
