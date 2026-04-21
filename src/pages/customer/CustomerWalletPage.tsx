import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Download, Plus, X, Loader2, ArrowDownLeft, ArrowUpRight, Wallet, CheckCircle2, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/features/auth/auth-context';
import { useTheme } from '@/lib/theme-context';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { deriveCustomerOrderMeta, formatCustomerDate, formatCustomerNumber, getCustomerOrderReceivedAmount, getCustomerOrderSentAmount, getDisplayedCustomerRate, listCustomerOrders, type CustomerOrderRow } from '@/features/customer/customer-portal';

// ── Local account types (stored in localStorage for now) ─────────────────────
type AccountType = 'bank' | 'mobile_wallet' | 'cash' | 'other';
interface LocalAccount { id: string; name: string; type: AccountType; currency: string; balance: number; note?: string; }

const ACCOUNT_TYPES: { value: AccountType; en: string; ar: string }[] = [
  { value: 'bank',          en: 'Bank',          ar: 'بنك' },
  { value: 'mobile_wallet', en: 'Mobile Wallet', ar: 'محفظة موبايل' },
  { value: 'cash',          en: 'Cash',          ar: 'نقد' },
  { value: 'other',         en: 'Other',         ar: 'أخرى' },
];

function loadAccounts(userId: string): LocalAccount[] {
  try { return JSON.parse(localStorage.getItem(`c_accounts_${userId}`) ?? '[]'); } catch { return []; }
}
function saveAccounts(userId: string, accounts: LocalAccount[]) {
  localStorage.setItem(`c_accounts_${userId}`, JSON.stringify(accounts));
}

export default function CustomerWalletPage() {
  const { userId, customerProfile } = useAuth();
  const { settings } = useTheme();
  const lang = settings.language === 'ar' ? 'ar' : 'en';
  const L = (en: string, ar: string) => lang === 'ar' ? ar : en;
  const fmt = (v: number, d = 0) => formatCustomerNumber(v, lang, d);
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<AccountType>('bank');
  const [newBalance, setNewBalance] = useState('');
  const [newCurrency, setNewCurrency] = useState('EGP');
  const [accounts, setAccounts] = useState<LocalAccount[]>(() => userId ? loadAccounts(userId) : []);
  const [filter, setFilter] = useState<'all' | 'completed' | 'active'>('all');

  const { data: orders = [], isLoading } = useQuery<CustomerOrderRow[]>({
    queryKey: ['c-cash-orders', userId],
    queryFn: async () => { if (!userId) return []; const { data } = await listCustomerOrders(userId); return (data ?? []) as CustomerOrderRow[]; },
    enabled: !!userId,
  });

  const summary = useMemo(() => {
    const completed = orders.filter(o => o.status === 'completed');
    const active    = orders.filter(o => !['completed','cancelled','quote_rejected'].includes(o.status));
    const totalSent = completed.reduce((s, o) => s + getCustomerOrderSentAmount(o), 0);
    const totalRecv = completed.reduce((s, o) => s + getCustomerOrderReceivedAmount(o), 0);
    const avgFx     = totalSent > 0 ? totalRecv / totalSent : null;
    const successRate = orders.length > 0 ? Math.round((completed.length / Math.max(1, orders.filter(o => o.status !== 'pending_quote').length)) * 100) : 0;
    return { completed, active, totalSent, totalRecv, avgFx, successRate };
  }, [orders]);

  const filtered = filter === 'completed' ? summary.completed : filter === 'active' ? summary.active : orders;

  const addAccount = () => {
    if (!newName.trim() || !userId) return;
    const acc: LocalAccount = { id: crypto.randomUUID(), name: newName.trim(), type: newType, currency: newCurrency, balance: parseFloat(newBalance) || 0 };
    const updated = [...accounts, acc];
    setAccounts(updated); saveAccounts(userId, updated);
    setNewName(''); setNewBalance(''); setShowAddAccount(false);
    toast.success(L('Account added', 'تم إضافة الحساب'));
  };

  const removeAccount = (id: string) => {
    if (!userId) return;
    const updated = accounts.filter(a => a.id !== id);
    setAccounts(updated); saveAccounts(userId, updated);
  };

  const exportCSV = () => {
    const rows = [
      ['Date','Corridor','Sent QAR','Rate','Received EGP','Rail','Status'],
      ...summary.completed.map(o => {
        const meta = deriveCustomerOrderMeta(o, customerProfile?.country);
        const rate = getDisplayedCustomerRate(o);
        return [new Date(o.created_at).toLocaleDateString(), meta.corridorLabel, o.amount, rate ?? '', getCustomerOrderReceivedAmount(o), o.payout_rail ?? '', o.status];
      }),
    ].map(r => r.join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([rows], { type: 'text/csv' }));
    a.download = `cash-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">{L('Cash Management', 'إدارة النقد')}</h1>
        {summary.completed.length > 0 && (
          <button onClick={exportCSV} className="flex items-center gap-1.5 rounded-xl border border-border/50 px-3 py-2 text-xs font-semibold text-muted-foreground hover:bg-muted">
            <Download className="h-3.5 w-3.5" />{L('Export', 'تصدير')}
          </button>
        )}
      </div>

      {/* Incoming orders summary */}
      <div className="rounded-2xl border border-border/50 bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border/40">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{L('From Orders', 'من الطلبات')}</p>
        </div>
        <div className="grid grid-cols-2 divide-x divide-border/40">
          <div className="p-4"><div className="flex items-center gap-1 mb-1"><ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground" /><p className="text-[10px] text-muted-foreground">{L('Sent (QAR)', 'مُرسَل')}</p></div><p className="text-xl font-black tabular-nums">{fmt(summary.totalSent)}</p></div>
          <div className="p-4"><div className="flex items-center gap-1 mb-1"><ArrowDownLeft className="h-3.5 w-3.5 text-emerald-500" /><p className="text-[10px] text-muted-foreground">{L('Received (EGP)', 'مُستلَم')}</p></div><p className="text-xl font-black tabular-nums text-emerald-600">{fmt(summary.totalRecv)}</p></div>
        </div>
        <div className="grid grid-cols-3 divide-x divide-border/40 border-t border-border/40">
          <div className="p-3 text-center"><p className="text-[10px] text-muted-foreground">{L('Completed', 'مكتمل')}</p><p className="text-base font-black">{summary.completed.length}</p></div>
          <div className="p-3 text-center"><p className="text-[10px] text-muted-foreground">{L('Success rate', 'معدل النجاح')}</p><p className="text-base font-black">{summary.successRate}%</p></div>
          <div className="p-3 text-center"><p className="text-[10px] text-muted-foreground">{L('Avg FX', 'متوسط السعر')}</p><p className="text-base font-black tabular-nums">{summary.avgFx != null ? fmt(summary.avgFx, 4) : '—'}</p></div>
        </div>
      </div>

      {/* Accounts */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{L('My Accounts', 'حساباتي')}</p>
          <button onClick={() => setShowAddAccount(true)} className="flex items-center gap-1 text-xs text-primary font-medium"><Plus className="h-3.5 w-3.5" />{L('Add', 'إضافة')}</button>
        </div>
        {accounts.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border/50 py-6 text-center">
            <Wallet className="h-6 w-6 text-muted-foreground/40 mx-auto mb-2" />
            <p className="text-xs text-muted-foreground">{L('No accounts yet', 'لا توجد حسابات')}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {accounts.map(acc => (
              <div key={acc.id} className="flex items-center gap-3 rounded-2xl border border-border/50 bg-card px-4 py-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted">
                  <Wallet className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">{acc.name}</p>
                  <p className="text-[11px] text-muted-foreground">{ACCOUNT_TYPES.find(t => t.value === acc.type)?.[lang] ?? acc.type}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold tabular-nums">{fmt(acc.balance)} {acc.currency}</p>
                </div>
                <button onClick={() => removeAccount(acc.id)} className="p-1 text-muted-foreground hover:text-destructive"><X className="h-3.5 w-3.5" /></button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add account form */}
      {showAddAccount && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-sm" onClick={() => setShowAddAccount(false)}>
          <div className="w-full max-w-lg rounded-t-3xl bg-background p-5 pb-8 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between"><h2 className="text-base font-bold">{L('Add Account', 'إضافة حساب')}</h2><button onClick={() => setShowAddAccount(false)} className="rounded-full p-1.5 hover:bg-muted"><X className="h-4 w-4" /></button></div>
            <div><label className="mb-1.5 block text-xs font-medium text-muted-foreground">{L('Account name', 'اسم الحساب')}</label><input value={newName} onChange={e => setNewName(e.target.value)} placeholder={L('e.g. CIB Bank', 'مثال: بنك CIB')} className="h-11 w-full rounded-xl border border-border/50 bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-primary/30" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="mb-1.5 block text-xs font-medium text-muted-foreground">{L('Type', 'النوع')}</label><select value={newType} onChange={e => setNewType(e.target.value as AccountType)} className="h-11 w-full rounded-xl border border-border/50 bg-card px-3 text-sm outline-none">{ACCOUNT_TYPES.map(t => <option key={t.value} value={t.value}>{t[lang]}</option>)}</select></div>
              <div><label className="mb-1.5 block text-xs font-medium text-muted-foreground">{L('Currency', 'العملة')}</label><select value={newCurrency} onChange={e => setNewCurrency(e.target.value)} className="h-11 w-full rounded-xl border border-border/50 bg-card px-3 text-sm outline-none"><option value="EGP">EGP</option><option value="QAR">QAR</option><option value="USD">USD</option></select></div>
            </div>
            <div><label className="mb-1.5 block text-xs font-medium text-muted-foreground">{L('Current balance', 'الرصيد الحالي')}</label><input value={newBalance} onChange={e => setNewBalance(e.target.value)} type="number" min="0" placeholder="0" className="h-11 w-full rounded-xl border border-border/50 bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-primary/30" /></div>
            <button onClick={addAccount} disabled={!newName.trim()} className="flex h-11 w-full items-center justify-center rounded-xl bg-primary text-sm font-bold text-primary-foreground disabled:opacity-50">{L('Add Account', 'إضافة الحساب')}</button>
          </div>
        </div>
      )}

      {/* Movement ledger */}
      <div>
        <div className="flex gap-1 rounded-xl bg-muted p-1 mb-3">
          {(['all','completed','active'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)} className={cn('flex-1 rounded-lg py-1.5 text-xs font-semibold transition-colors', filter === f ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground')}>
              {f === 'all' ? L('All', 'الكل') : f === 'completed' ? L('Completed', 'مكتمل') : L('Active', 'نشط')}
            </button>
          ))}
        </div>
        {isLoading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">…</div>
        ) : filtered.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">{L('No transactions', 'لا توجد معاملات')}</div>
        ) : (
          <div className="rounded-2xl border border-border/50 bg-card overflow-hidden">
            {filtered.map((o, i) => {
              const meta = deriveCustomerOrderMeta(o, customerProfile?.country);
              const rate = getDisplayedCustomerRate(o);
              const recv = getCustomerOrderReceivedAmount(o);
              return (
                <div key={o.id} className={cn('px-4 py-3', i > 0 && 'border-t border-border/40')}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold">{fmt(o.amount)} QAR</span>
                        {o.status === 'completed' && recv > 0 && <span className="text-sm font-semibold text-emerald-600">→ {fmt(recv)} EGP</span>}
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 flex-wrap">
                        {rate != null && <span className="text-[11px] text-muted-foreground tabular-nums">@ {fmt(rate, 4)}</span>}
                        {o.payout_rail && <span className="text-[11px] text-muted-foreground">{o.payout_rail.replace(/_/g,' ')}</span>}
                        <span className="text-[11px] text-muted-foreground">{formatCustomerDate(o.created_at, lang)}</span>
                      </div>
                    </div>
                    <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold', o.status === 'completed' ? 'bg-emerald-500/10 text-emerald-600' : ['cancelled','quote_rejected'].includes(o.status) ? 'bg-red-500/10 text-red-500' : 'bg-amber-500/10 text-amber-600')}>
                      {o.status.replace(/_/g,' ')}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
