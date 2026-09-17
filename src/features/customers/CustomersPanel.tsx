import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useAuth } from '@/features/auth/auth-context';
import { useT } from '@/lib/i18n';
import {
  fmtTotal, fmtDate, uid, shortRef, resolveCustomerName, customerNameVariants,
  type Customer, type TrackerState, type DerivedState,
} from '@/lib/tracker-helpers';
import { canonicalizeName } from '@/lib/text-normalize';
import { mapConnectedCustomers, mergeListedCustomers } from '@/features/merchants/lib/customer-listing';
import { extractFunctionErrorMessage } from '@/lib/edge-function-error';
import { supabase } from '@/integrations/supabase/client';

// ── Blank customer factory ────────────────────────────────────────────
const blankCustomer = (): Omit<Customer, 'id' | 'createdAt'> => ({
  name: '', nameEn: '', nameAr: '', phone: '', tier: 'C', dailyLimitUSDT: 0, notes: '',
});

// ── Modal wrapper — defined OUTSIDE the panel so React never remounts it ──
function CustomerModal({
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

type CustomerRow = Customer & { source?: 'local' | 'connected' };

/**
 * Customer/buyer management -- moved out of the old combined CRM page so it
 * lives with order-taking (Orders page) instead of a separate section, with
 * suppliers split out to their own panel on the Stock page. Reuses the host
 * page's own `state`/`applyState` rather than a second useTrackerState
 * subscription (see tracker-sync notes on why one merchant device shouldn't
 * hold two independent local-first copies of the same snapshot at once).
 */
export function CustomersPanel({ state, applyState, derived }: { state: TrackerState; applyState: (next: TrackerState) => void; derived: DerivedState }) {
  const t = useT();
  const { merchantProfile } = useAuth();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');

  const [showCustModal, setShowCustModal] = useState(false);
  const [editingCust, setEditingCust] = useState<Customer | null>(null);
  const [custForm, setCustForm] = useState(blankCustomer());
  const [custError, setCustError] = useState('');

  const [loginModalCust, setLoginModalCust] = useState<Customer | null>(null);
  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginConfirm, setLoginConfirm] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginSaving, setLoginSaving] = useState(false);

  const openCreateLogin = (c: Customer) => {
    setLoginModalCust(c);
    setLoginUsername('');
    setLoginPassword('');
    setLoginConfirm('');
    setLoginError('');
  };

  const submitCreateLogin = async () => {
    if (!loginModalCust) return;
    const username = loginUsername.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(username)) {
      setLoginError('Username must be 3-32 characters: lowercase letters, numbers, dots, dashes, or underscores');
      return;
    }
    if (loginPassword.length < 8) {
      setLoginError('Password must be at least 8 characters');
      return;
    }
    if (loginPassword !== loginConfirm) {
      setLoginError('Passwords do not match');
      return;
    }
    setLoginSaving(true);
    setLoginError('');
    try {
      const { data, error } = await supabase.functions.invoke('admin-create-customer-login', {
        body: { username, password: loginPassword, displayName: loginModalCust.name, phone: loginModalCust.phone },
      });
      if (error || !data || (data as { error?: string }).error) {
        throw new Error(await extractFunctionErrorMessage(error, data, 'Could not create login'));
      }
      toast.success(`Login created for ${loginModalCust.name}: username "${username}"`);
      qc.invalidateQueries({ queryKey: ['crm-connected-customers', merchantProfile?.merchant_id] });
      setLoginModalCust(null);
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : 'Could not create login');
    } finally {
      setLoginSaving(false);
    }
  };

  const customers = state.customers ?? [];

  const { data: connectedCustomers = [] } = useQuery({
    queryKey: ['crm-connected-customers', merchantProfile?.merchant_id],
    queryFn: async () => {
      if (!merchantProfile?.merchant_id) return [];
      const { data: connections, error } = await supabase
        .from('customer_merchant_connections')
        .select('customer_user_id, created_at, status, nickname')
        .eq('merchant_id', merchantProfile.merchant_id)
        .neq('status', 'blocked')
        .order('created_at', { ascending: false });
      if (error || !connections || connections.length === 0) return [];

      const userIds = [...new Set(connections.map((row) => row.customer_user_id))];
      const { data: profiles } = await supabase
        .from('customer_profiles')
        .select('user_id, display_name, phone, region, country')
        .in('user_id', userIds);
      const profileMap = new Map((profiles ?? []).map((profile: { user_id: string }) => [profile.user_id, profile]));

      return mapConnectedCustomers(
        connections as Array<{ customer_user_id: string; nickname?: string | null; created_at?: string | null; status?: string | null }>,
        profileMap,
      );
    },
    enabled: !!merchantProfile?.merchant_id,
  });

  const mergedCustomers = useMemo<CustomerRow[]>(
    () => mergeListedCustomers(customers, connectedCustomers) as CustomerRow[],
    [connectedCustomers, customers],
  );

  const filteredCustomers = useMemo(() => {
    if (!search) return mergedCustomers;
    const q = search.toLowerCase();
    return mergedCustomers.filter(c =>
      c.name.toLowerCase().includes(q)
      || (c.nameEn || '').toLowerCase().includes(q)
      || (c.nameAr || '').toLowerCase().includes(q)
      || c.phone.includes(q),
    );
  }, [mergedCustomers, search]);

  // One real-world buyer can be spread across several Customer records (a
  // local row plus a connected-portal row, or a cosmetic near-duplicate) --
  // filtering a buyer's stats by a single id undercounts trades/volume/P&L
  // for exactly that buyer. Group every id sharing a canonical name so a
  // row's stats reflect everything the merchant actually did with them, the
  // same union OrdersPage's own buyer filter uses.
  const customerIdsByCanonicalName = useMemo(() => {
    const map = new Map<string, string[]>();
    const addAll = (rows: { id: string; name: string }[]) => {
      for (const row of rows) {
        const key = canonicalizeName(row.name);
        const bucket = map.get(key);
        if (bucket) { if (!bucket.includes(row.id)) bucket.push(row.id); } else map.set(key, [row.id]);
      }
    };
    addAll(customers);
    addAll(connectedCustomers);
    return map;
  }, [customers, connectedCustomers]);

  const customerStats = (c: CustomerRow) => {
    const groupIds = new Set(customerIdsByCanonicalName.get(canonicalizeName(c.name)) ?? [c.id]);
    const trades = state.trades.filter(tr => !tr.voided && groupIds.has(tr.customerId));
    const totalUSDT = trades.reduce((s, tr) => s + tr.amountUSDT, 0);
    const totalRevenue = trades.reduce((s, tr) => s + tr.amountUSDT * tr.sellPriceQAR, 0);
    // Real FIFO-matched profit (same source as the Orders page's own Net
    // P&L column) rather than an average-cost estimate -- a trade FIFO
    // couldn't fully match against stock counts as 0 here, consistent with
    // how the rest of the app treats an unmatched trade.
    const pnl = trades.reduce((s, tr) => {
      const calc = derived.tradeCalc.get(tr.id);
      return s + (calc?.ok ? calc.netQAR : 0);
    }, 0);
    const lastTrade = trades.length > 0 ? Math.max(...trades.map(tr => tr.ts)) : 0;
    return { trades: trades.length, totalUSDT, totalQAR: totalRevenue, pnl, lastTrade };
  };

  const kpis = useMemo(() => {
    const allTrades = state.trades.filter(tr => !tr.voided);
    const totalUSDT = allTrades.reduce((s, tr) => s + tr.amountUSDT, 0);
    const netPnl = allTrades.reduce((s, tr) => {
      const calc = derived.tradeCalc.get(tr.id);
      return s + (calc?.ok ? calc.netQAR : 0);
    }, 0);
    const linkedTrades = allTrades.filter(tr => tr.linkedRelId).length;
    const tierCounts = { A: 0, B: 0, C: 0 };
    for (const c of customers) {
      if (c.tier === 'A') tierCounts.A++;
      else if (c.tier === 'B') tierCounts.B++;
      else tierCounts.C++;
    }
    return { clients: customers.length, totalUSDT, netPnl, linkedTrades, tierCounts };
  }, [state.trades, derived.tradeCalc, customers]);

  const openAddCustomer = () => {
    setEditingCust(null);
    setCustForm(blankCustomer());
    setCustError('');
    setShowCustModal(true);
  };

  const openEditCustomer = (c: Customer) => {
    setEditingCust(c);
    setCustForm({
      name: c.name, nameEn: c.nameEn || '', nameAr: c.nameAr || '',
      phone: c.phone, tier: c.tier, dailyLimitUSDT: c.dailyLimitUSDT, notes: c.notes,
    });
    setCustError('');
    setShowCustModal(true);
  };

  const saveCustomer = () => {
    const nameEn = custForm.nameEn?.trim() || '';
    const nameAr = custForm.nameAr?.trim() || '';
    if (!nameEn && !nameAr) { setCustError('At least one name (English or Arabic) is required.'); return; }
    // `name` is this buyer's identity key -- trades and loans are matched
    // back to them by it -- so an edit must never repoint it. Only a
    // brand-new customer gets one assigned, and from English first so it
    // never depends on which language the merchant happened to be using.
    const name = editingCust ? editingCust.name : (nameEn || nameAr);
    const entered = [nameEn, nameAr].filter(Boolean).map(canonicalizeName);
    const existing = customers.find(
      c => c.id !== editingCust?.id
        && customerNameVariants(c).some(v => entered.includes(canonicalizeName(v))),
    );
    if (existing) { setCustError('A customer with this name already exists.'); return; }

    const patch = { ...custForm, nameEn, nameAr, name };
    const next = editingCust
      ? customers.map(c => c.id === editingCust.id ? { ...c, ...patch } : c)
      : [...customers, { id: uid(), createdAt: Date.now(), ...patch } as Customer];

    applyState({ ...state, customers: next });
    setShowCustModal(false);
  };

  const deleteCustomer = (id: string) => {
    if (!window.confirm('Delete this customer? This cannot be undone.')) return;
    applyState({ ...state, customers: customers.filter(c => c.id !== id) });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <KpiCard label="Clients" value={kpis.clients} />
        <KpiCard label="USDT Vol" value={fmtTotal(kpis.totalUSDT)} />
        <KpiCard label="Net P&L" value={(kpis.netPnl >= 0 ? '+' : '') + fmtTotal(kpis.netPnl)} color={kpis.netPnl >= 0 ? 'var(--good)' : 'var(--bad)'} />
        <KpiCard label="Linked Trades" value={kpis.linkedTrades} />
        <KpiCard label="⭐ A" value={kpis.tierCounts.A} color="var(--good)" />
        <KpiCard label="🔵 B" value={kpis.tierCounts.B} color="hsl(210 80% 60%)" />
        <KpiCard label="🔴 C" value={kpis.tierCounts.C} color="var(--bad)" />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 800 }}>{t('customers')}</div>
          <div style={{ fontSize: 10, color: 'var(--muted)' }}>{t('buyerManagement')}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div className="inputBox" style={{ maxWidth: 260, padding: '6px 10px' }}>
            <input
              placeholder={t('searchCustomers')}
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <button className="btn" onClick={openAddCustomer}>{t('addCustomer')}</button>
        </div>
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
                <th>ID</th>
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
                const s = customerStats(c);
                return (
                  <tr key={c.id}>
                    <td className="mono" style={{ fontSize: 10, color: 'var(--muted)', whiteSpace: 'nowrap' }} title={c.id}>
                      {shortRef('CUS', c.id)}
                    </td>
                    <td style={{ fontWeight: 700 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span>{resolveCustomerName(c, t.lang)}</span>
                        {c.source === 'connected' && (
                          <span className="pill good" style={{ fontSize: 10 }}>Connected</span>
                        )}
                      </div>
                    </td>
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
                        {c.source !== 'connected' ? (
                          <>
                            <button className="rowBtn" onClick={() => openEditCustomer(c)}>Edit</button>
                            <button className="rowBtn" style={{ color: 'var(--brand)' }} onClick={() => openCreateLogin(c)}>Create login</button>
                            <button className="rowBtn" style={{ color: 'var(--bad)', fontWeight: 700, fontSize: 14, lineHeight: 1, padding: '2px 6px', border: '1px solid var(--bad)', borderRadius: 4 }} onClick={() => deleteCustomer(c.id)}>✕</button>
                          </>
                        ) : (
                          <span style={{ fontSize: 10, color: 'var(--muted)' }}>Synced from merchant connection</span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showCustModal && (
        <CustomerModal
          title={editingCust ? `Edit — ${resolveCustomerName(editingCust, t.lang)}` : t('addCustomer')}
          onClose={() => setShowCustModal(false)}
          onSave={saveCustomer}
          error={custError}
        >
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <FormField label="Name (English)">
              <input
                className="inputBox"
                style={{ padding: '6px 10px', width: '100%' }}
                placeholder="e.g. Ahmed Al-Rashid"
                dir="ltr"
                value={custForm.nameEn}
                autoFocus={t.lang !== 'ar'}
                onChange={e => setCustForm(f => ({ ...f, nameEn: e.target.value }))}
              />
            </FormField>
            <FormField label="Name (Arabic)">
              <input
                className="inputBox"
                style={{ padding: '6px 10px', width: '100%' }}
                placeholder="مثال: أحمد الراشد"
                dir="rtl"
                value={custForm.nameAr}
                autoFocus={t.lang === 'ar'}
                onChange={e => setCustForm(f => ({ ...f, nameAr: e.target.value }))}
              />
            </FormField>
          </div>
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
        </CustomerModal>
      )}

      {loginModalCust && (
        <CustomerModal
          title={`Create Portal Login — ${loginModalCust.name}`}
          onClose={() => setLoginModalCust(null)}
          onSave={submitCreateLogin}
          error={loginError}
        >
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>
            The customer signs into the customer portal with this username and password — no email needed.
          </div>
          <FormField label="Username *">
            <input
              className="inputBox"
              style={{ padding: '6px 10px', width: '100%' }}
              placeholder="e.g. damrawy"
              value={loginUsername}
              autoFocus
              disabled={loginSaving}
              onChange={e => setLoginUsername(e.target.value)}
            />
          </FormField>
          <FormField label="Password *">
            <input
              className="inputBox"
              type="text"
              style={{ padding: '6px 10px', width: '100%' }}
              placeholder="At least 8 characters"
              value={loginPassword}
              disabled={loginSaving}
              onChange={e => setLoginPassword(e.target.value)}
            />
          </FormField>
          <FormField label="Confirm Password *">
            <input
              className="inputBox"
              type="text"
              style={{ padding: '6px 10px', width: '100%' }}
              value={loginConfirm}
              disabled={loginSaving}
              onChange={e => setLoginConfirm(e.target.value)}
            />
          </FormField>
        </CustomerModal>
      )}
    </div>
  );
}
