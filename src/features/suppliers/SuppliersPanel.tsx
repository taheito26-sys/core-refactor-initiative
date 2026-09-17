import { useEffect, useMemo, useState } from 'react';
import { useT } from '@/lib/i18n';
import { fmtTotal, fmtPrice, fmtDate, uid, shortRef, type Supplier, type TrackerState } from '@/lib/tracker-helpers';
import { localCur } from '@/lib/currency-locale';

// ── Modal wrapper — defined OUTSIDE the panel so React never remounts it ──
function SupplierModal({
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

function SupplierCard({ supplier, maxUSDT, onEdit, onDelete, lang }: {
  supplier: { id: string; name: string; batchCount: number; totalUSDT: number; avgCost: number; spentQAR: number; lastDate: number; volumePct: number };
  maxUSDT: number;
  onEdit: () => void;
  onDelete: () => void;
  lang: 'en' | 'ar';
}) {
  const pct = maxUSDT > 0 ? Math.round((supplier.totalUSDT / maxUSDT) * 100) : 0;
  return (
    <div style={{
      border: '1px solid var(--line)', borderRadius: 10, padding: 14,
      background: 'var(--surface)', display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 800 }}>{supplier.name}</div>
          <div className="mono" style={{ fontSize: 9, color: 'var(--muted)' }} title={supplier.id}>{shortRef('SUP', supplier.id)}</div>
        </div>
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
          <div style={{ fontSize: 8, fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted)', letterSpacing: '0.06em' }}>SPENT {localCur('QAR', lang)}</div>
          <div style={{ fontSize: 14, fontWeight: 800, fontFamily: 'var(--mono, monospace)' }}>{fmtTotal(supplier.spentQAR)}</div>
        </div>
      </div>

      <div style={{ fontSize: 10, color: 'var(--muted)' }}>Last supply: {fmtDate(supplier.lastDate)}</div>

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

/**
 * Supplier management -- moved out of the old combined CRM page so it lives
 * with stock intake (Stock page) instead of a separate section, with
 * customers split out to their own panel on the Orders page. Reuses the
 * host page's own `state`/`applyState` rather than a second useTrackerState
 * subscription.
 */
export function SuppliersPanel({ state, applyState }: { state: TrackerState; applyState: (next: TrackerState) => void }) {
  const t = useT();
  const [search, setSearch] = useState('');

  const [showSuppModal, setShowSuppModal] = useState(false);
  const [editingSupp, setEditingSupp] = useState('');
  const [suppName, setSuppName] = useState('');
  const [suppError, setSuppError] = useState('');

  const [showAddSuppModal, setShowAddSuppModal] = useState(false);
  const [newSuppName, setNewSuppName] = useState('');
  const [newSuppError, setNewSuppError] = useState('');

  const supplierMaster = state.suppliers ?? [];

  // Backfill legacy supplier names from historical batches into the supplier
  // master list once, same as the CRM page used to.
  useEffect(() => {
    const existing = new Set((state.suppliers || []).map(s => s.name.trim().toLowerCase()).filter(Boolean));
    const toAdd: Supplier[] = [];
    state.batches.forEach((b) => {
      const name = b.source.trim();
      const key = name.toLowerCase();
      if (!name || existing.has(key)) return;
      existing.add(key);
      toAdd.push({ id: uid(), name, phone: '', notes: '', createdAt: Date.now() });
    });
    if (!toAdd.length) return;
    applyState({ ...state, suppliers: [...(state.suppliers || []), ...toAdd] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.batches]);

  const suppliers = useMemo(() => {
    const batchStats = new Map<string, { batchCount: number; totalUSDT: number; spentQAR: number; lastDate: number }>();
    let grandTotal = 0;
    for (const b of state.batches) {
      const src = b.source.trim();
      if (!src) continue;
      const key = src.toLowerCase();
      const cost = b.initialUSDT * b.buyPriceQAR;
      const ex = batchStats.get(key);
      if (ex) {
        ex.batchCount++;
        ex.totalUSDT += b.initialUSDT;
        ex.spentQAR += cost;
        ex.lastDate = Math.max(ex.lastDate, b.ts);
      } else {
        batchStats.set(key, { batchCount: 1, totalUSDT: b.initialUSDT, spentQAR: cost, lastDate: b.ts });
      }
      grandTotal += b.initialUSDT;
    }

    return supplierMaster.map((supplier) => {
      const stats = batchStats.get(supplier.name.trim().toLowerCase());
      const totalUSDT = stats?.totalUSDT ?? 0;
      const spentQAR = stats?.spentQAR ?? 0;
      return {
        ...supplier,
        batchCount: stats?.batchCount ?? 0,
        totalUSDT,
        spentQAR,
        avgCost: totalUSDT > 0 ? spentQAR / totalUSDT : 0,
        lastDate: stats?.lastDate ?? supplier.createdAt,
        volumePct: grandTotal > 0 ? (totalUSDT / grandTotal) * 100 : 0,
      };
    }).sort((a, b) => b.totalUSDT - a.totalUSDT || a.name.localeCompare(b.name));
  }, [state.batches, supplierMaster]);

  const filteredSuppliers = useMemo(() => {
    if (!search) return suppliers;
    const q = search.toLowerCase();
    return suppliers.filter(s => s.name.toLowerCase().includes(q));
  }, [suppliers, search]);

  const maxSupplierUSDT = useMemo(() => {
    return suppliers.reduce((max, s) => Math.max(max, s.totalUSDT), 0);
  }, [suppliers]);

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
    const newSupplier: Supplier = { id: uid(), name, phone: '', notes: '', createdAt: Date.now() };
    applyState({ ...state, suppliers: [...(state.suppliers || []), newSupplier] });
    setShowAddSuppModal(false);
  };

  const saveSupplier = () => {
    if (!suppName.trim()) { setSuppError('Name is required.'); return; }
    const nextName = suppName.trim();
    if (nextName.toLowerCase() !== editingSupp.toLowerCase() && suppliers.some(s => s.name.toLowerCase() === nextName.toLowerCase())) {
      setSuppError('A supplier with this name already exists.');
      return;
    }
    applyState({
      ...state,
      suppliers: (state.suppliers || []).map(s =>
        s.name.toLowerCase() === editingSupp.toLowerCase() ? { ...s, name: nextName } : s,
      ),
    });
    setShowSuppModal(false);
  };

  const deleteSupplier = (name: string) => {
    if (!window.confirm(`Delete supplier "${name}"? Stock batches will be kept.`)) return;
    applyState({
      ...state,
      suppliers: (state.suppliers || []).filter(s => s.name.toLowerCase() !== name.toLowerCase()),
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 800 }}>{t('suppliers')}</div>
          <div style={{ fontSize: 10, color: 'var(--muted)' }}>{t('autoTrackedFromBatches')}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div className="inputBox" style={{ maxWidth: 260, padding: '6px 10px' }}>
            <input
              placeholder={t('searchSuppliers')}
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <button className="btn" onClick={openAddSupplier}>+ {t('addSupplier')}</button>
        </div>
      </div>

      <div style={{ fontSize: 11, color: 'var(--muted)', background: 'color-mix(in srgb, var(--warn) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--warn) 25%, transparent)', borderRadius: 8, padding: '8px 12px' }}>
        💡 Suppliers are auto-tracked from batch source names when you add stock, or you can add them directly here.
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
              lang={t.lang}
            />
          ))}
        </div>
      )}

      {showSuppModal && (
        <SupplierModal
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
        </SupplierModal>
      )}

      {showAddSuppModal && (
        <SupplierModal
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
        </SupplierModal>
      )}
    </div>
  );
}
