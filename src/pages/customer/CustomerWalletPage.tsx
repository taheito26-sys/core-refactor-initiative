import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, X, Loader2, Trash2, Edit2, Check, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/features/auth/auth-context";
import { useTheme } from "@/lib/theme-context";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { formatCustomerNumber } from "@/features/customer/customer-portal";
import { getCashAccountsForUser, type CashAccount } from "@/features/orders/shared-order-workflow";
import {
  deriveCashQAR,
  getAccountBalance,
  getAllAccountBalances,
  type CashLedgerEntry,
} from "@/lib/tracker-helpers";

type AccountType = "bank" | "mobile_wallet" | "cash" | "other";

type CustomerCashLedgerRow = {
  id: string;
  user_id: string;
  account_id: string;
  contra_account_id: string | null;
  ts: number;
  type: CashLedgerEntry["type"];
  direction: CashLedgerEntry["direction"];
  amount: number;
  currency: string;
  note: string | null;
  linked_entity_id: string | null;
  linked_entity_type: string | null;
  order_id: string | null;
  batch_id: string | null;
  created_at: string;
};

const ACCOUNT_TYPES: { value: AccountType; en: string; ar: string }[] = [
  { value: "bank",          en: "Bank",          ar: "بنك" },
  { value: "mobile_wallet", en: "Mobile Wallet", ar: "محفظة موبايل" },
  { value: "cash",          en: "Cash",          ar: "نقد" },
  { value: "other",         en: "Other",         ar: "أخرى" },
];

const CURRENCIES = ["QAR", "EGP", "SAR", "AED", "KWD", "BHD", "OMR", "USD", "EUR"];

export default function CustomerWalletPage() {
  const { userId } = useAuth();
  const { settings } = useTheme();
  const qc = useQueryClient();
  const lang = settings.language;
  const L = (en: string, ar: string) => lang === "ar" ? ar : en;
  const fmt = (v: number, d = 0) => formatCustomerNumber(v, lang, d);

  const [showAddAccount, setShowAddAccount] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<AccountType>("bank");
  const [newCurrency, setNewCurrency] = useState("EGP");

  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ['customer-cash-accounts', userId],
    queryFn: async () => {
      if (!userId) return [];
      return getCashAccountsForUser(userId);
    },
    enabled: !!userId,
  });

  const { data: ledger = [], isLoading: isLedgerLoading } = useQuery({
    queryKey: ['customer-cash-ledger', userId],
    queryFn: async () => {
      if (!userId) return [] as CustomerCashLedgerRow[];
      const { data, error } = await supabase
        .from('cash_ledger')
        .select('*')
        .eq('user_id', userId)
        .order('ts', { ascending: false });
      if (error) throw error;
      return (data ?? []) as CustomerCashLedgerRow[];
    },
    enabled: !!userId,
  });

  // Subscribe to cash account changes
  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`c-cash-accounts-${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'cash_accounts', filter: `user_id=eq.${userId}` },
        () => {
          qc.invalidateQueries({ queryKey: ['customer-cash-accounts', userId] });
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'cash_ledger', filter: `user_id=eq.${userId}` },
        () => {
          qc.invalidateQueries({ queryKey: ['customer-cash-ledger', userId] });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [qc, userId]);

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!userId || !newName.trim()) throw new Error(L('Enter account name', 'أدخل اسم الحساب'));

      const { data, error } = await supabase
        .from('cash_accounts')
        .insert({
          user_id: userId,
          name: newName.trim(),
          type: newType,
          currency: newCurrency,
          status: 'active',
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success(L('Account added', 'تم إضافة الحساب'));
      setNewName('');
      setNewType('bank');
      setNewCurrency('EGP');
      setShowAddAccount(false);
      qc.invalidateQueries({ queryKey: ['customer-cash-accounts', userId] });
    },
    onError: (error: any) => {
      toast.error(error?.message ?? L('Failed to add account', 'فشل إضافة الحساب'));
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      if (!name.trim()) throw new Error(L('Enter account name', 'أدخل اسم الحساب'));

      const { data, error } = await supabase
        .from('cash_accounts')
        .update({ name: name.trim() })
        .eq('id', id)
        .eq('user_id', userId)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success(L('Account updated', 'تم تحديث الحساب'));
      setEditingId(null);
      qc.invalidateQueries({ queryKey: ['customer-cash-accounts', userId] });
    },
    onError: (error: any) => {
      toast.error(error?.message ?? L('Failed to update account', 'فشل تحديث الحساب'));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('cash_accounts')
        .delete()
        .eq('id', id)
        .eq('user_id', userId);

      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(L('Account removed', 'تم حذف الحساب'));
      qc.invalidateQueries({ queryKey: ['customer-cash-accounts', userId] });
    },
    onError: (error: any) => {
      toast.error(error?.message ?? L('Failed to remove account', 'فشل حذف الحساب'));
    },
  });

  const activeAccounts = useMemo(() => accounts.filter(a => a.status === 'active'), [accounts]);
  const accountBalances = useMemo(() => getAllAccountBalances(activeAccounts, ledger as CashLedgerEntry[]), [activeAccounts, ledger]);
  const customerCashQar = useMemo(() => deriveCashQAR(activeAccounts, ledger as CashLedgerEntry[]), [activeAccounts, ledger]);
  const recentLedger = useMemo(() => ledger.slice(0, 8), [ledger]);

  return (
    <div className="space-y-6 pb-16">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b border-border/40 px-4 py-4 -mx-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">{L('My Cash Accounts', 'حساباتي')}</h1>
          <button
            onClick={() => setShowAddAccount(true)}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            {L('Add Account', 'إضافة حساب')}
          </button>
        </div>
      </div>

      <div className="mx-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-border/60 bg-card px-4 py-4">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {L('Client Cash', 'النقد العميل')}
          </div>
          <div className="mt-2 text-2xl font-black text-foreground">
            {fmt(customerCashQar, 2)} QAR
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {L('Active client-owned QAR balance', 'رصيد الحسابات النشطة المملوكة للعميل')}
          </div>
        </div>
        <div className="rounded-2xl border border-border/60 bg-card px-4 py-4">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {L('Accounts', 'الحسابات')}
          </div>
          <div className="mt-2 text-2xl font-black text-foreground">
            {activeAccounts.length}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {L('Client-owned active cash accounts', 'حسابات نقدية نشطة مملوكة للعميل')}
          </div>
        </div>
        <div className="rounded-2xl border border-border/60 bg-card px-4 py-4">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {L('Latest Move', 'آخر حركة')}
          </div>
          <div className="mt-2 text-2xl font-black text-foreground">
            {ledger[0] ? `${ledger[0].direction === 'in' ? '+' : '-'}${fmt(ledger[0].amount, 2)}` : '—'}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {ledger[0] ? ledger[0].note ?? ledger[0].type : L('No ledger entries yet', 'لا توجد حركات بعد')}
          </div>
        </div>
      </div>

      {/* Add Account Modal */}
      {showAddAccount && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-sm" onClick={() => setShowAddAccount(false)}>
          <div className="w-full max-w-lg rounded-t-3xl bg-background p-5 pb-8 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold">{L('New Cash Account', 'حساب جديد')}</h2>
              <button onClick={() => setShowAddAccount(false)} className="rounded-full p-1.5 hover:bg-muted">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">{L('Account Name', 'اسم الحساب')}</label>
              <input
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder={L('e.g., My Bank Account', 'مثل: حسابي البنكي')}
                className="h-11 w-full rounded-xl border border-border/50 bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">{L('Account Type', 'نوع الحساب')}</label>
              <select value={newType} onChange={e => setNewType(e.target.value as AccountType)}
                className="h-11 w-full rounded-xl border border-border/50 bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-primary/30">
                {ACCOUNT_TYPES.map(t => <option key={t.value} value={t.value}>{lang === 'ar' ? t.ar : t.en}</option>)}
              </select>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">{L('Currency', 'العملة')}</label>
              <select value={newCurrency} onChange={e => setNewCurrency(e.target.value)}
                className="h-11 w-full rounded-xl border border-border/50 bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-primary/30">
                {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>

            <button
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending || !newName.trim()}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-bold text-primary-foreground disabled:opacity-50"
            >
              {createMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {L('Add Account', 'إضافة حساب')}
            </button>
          </div>
        </div>
      )}

      {/* Content */}
      {isLoading ? (
        <div className="flex h-32 items-center justify-center px-4">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : activeAccounts.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border/60 bg-card/30 px-6 py-12 text-center">
          <AlertCircle className="mx-auto h-8 w-8 text-muted-foreground mb-3" />
          <p className="text-muted-foreground">{L('No cash accounts yet', 'لا توجد حسابات نقدية بعد')}</p>
          <p className="text-xs text-muted-foreground mt-1">{L('Add your first account to start linking orders', 'أضف حسابك الأول لبدء ربط الطلبات')}</p>
        </div>
      ) : (
        <div className="space-y-3 px-4">
          {activeAccounts.map((account) => {
            const isEditing = editingId === account.id;
            const accountType = ACCOUNT_TYPES.find(t => t.value === account.type);

            return (
              <div key={account.id} className="overflow-hidden rounded-2xl border border-border/60 bg-card">
                <div className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 space-y-2">
                      {isEditing ? (
                        <div className="flex gap-2">
                          <input
                            type="text"
                            defaultValue={account.name}
                            onBlur={(e) => {
                              const value = e.currentTarget.value;
                              if (value.trim() !== account.name) {
                                updateMutation.mutate({ id: account.id, name: value });
                              } else {
                                setEditingId(null);
                              }
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                updateMutation.mutate({ id: account.id, name: e.currentTarget.value });
                              } else if (e.key === 'Escape') {
                                setEditingId(null);
                              }
                            }}
                            autoFocus
                            className="flex-1 rounded-lg border border-border/50 bg-muted px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                          />
                          <button
                            onClick={() => setEditingId(null)}
                            className="rounded-lg border border-border/50 px-3 py-1 text-sm hover:bg-muted"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold">{account.name}</span>
                            <span className="text-xs font-medium text-muted-foreground">
                              {accountType ? (lang === 'ar' ? accountType.ar : accountType.en) : account.type}
                            </span>
                          </div>
                          <div className="text-sm font-semibold text-primary">{account.currency}</div>
                          <div className="text-xs text-muted-foreground">
                            {L('Added', 'تمت الإضافة')} {new Date(account.created_at).toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-US')}
                          </div>
                        </>
                      )}
                    </div>

                    <div className="flex gap-1">
                      {!isEditing && (
                        <>
                          <button
                            onClick={() => setEditingId(account.id)}
                            className="rounded-lg border border-border/50 p-2 hover:bg-muted"
                            title={L('Edit account', 'تعديل الحساب')}
                          >
                            <Edit2 className="h-4 w-4 text-muted-foreground" />
                          </button>
                          <button
                            onClick={() => deleteMutation.mutate(account.id)}
                            disabled={deleteMutation.isPending}
                            className="rounded-lg border border-border/50 p-2 hover:bg-red-500/10 hover:text-red-600 disabled:opacity-50"
                            title={L('Delete account', 'حذف الحساب')}
                          >
                            {deleteMutation.isPending ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4 text-muted-foreground" />
                            )}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {activeAccounts.length > 0 && (
        <div className="mx-4 space-y-3">
          <h3 className="text-sm font-semibold text-foreground">{L('Balances by account', 'الأرصدة حسب الحساب')}</h3>
          <div className="space-y-2">
            {activeAccounts.map((account) => (
              <div key={account.id} className="rounded-2xl border border-border/60 bg-card px-4 py-3">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="font-semibold text-foreground">{account.name}</div>
                    <div className="text-xs text-muted-foreground">{account.currency} · {account.type}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-black text-primary">
                      {fmt(accountBalances.get(account.id) ?? getAccountBalance(account.id, ledger as CashLedgerEntry[]), 2)} {account.currency}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {L('Current balance', 'الرصيد الحالي')}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mx-4 space-y-3">
        <h3 className="text-sm font-semibold text-foreground">{L('Recent history', 'آخر الحركات')}</h3>
        {isLedgerLoading ? (
          <div className="flex h-20 items-center justify-center rounded-2xl border border-border/60 bg-card">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : recentLedger.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border/60 bg-card/30 px-6 py-8 text-center">
            <p className="text-sm text-muted-foreground">{L('No ledger history yet', 'لا توجد حركات بعد')}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {recentLedger.map((entry) => {
              const account = activeAccounts.find((item) => item.id === entry.account_id);
              return (
                <div key={entry.id} className="rounded-2xl border border-border/60 bg-card px-4 py-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-1">
                      <div className="font-semibold text-foreground">
                        {account?.name ?? entry.account_id}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {entry.note ?? entry.type}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {new Date(entry.ts).toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-US')}
                      </div>
                    </div>
                    <div className={cn(
                      'text-right text-sm font-black',
                      entry.direction === 'in' ? 'text-emerald-600' : 'text-rose-600',
                    )}>
                      {entry.direction === 'in' ? '+' : '-'}{fmt(entry.amount, 2)} {entry.currency}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Info Card */}
      <div className="mx-4 rounded-2xl border border-blue-500/20 bg-blue-500/5 px-4 py-4 space-y-2">
        <h3 className="font-semibold text-blue-700">{L('How to use cash accounts', 'كيفية استخدام الحسابات')}</h3>
        <ul className="space-y-1 text-xs text-blue-600/80">
          <li>• {L('Create accounts for each of your bank accounts or payment methods', 'أنشئ حسابات لكل حسابك البنكي أو طريقة دفع')}</li>
          <li>• {L('Link a cash account when placing an order with a merchant', 'ربط حساب عند تقديم طلب للتاجر')}</li>
          <li>• {L('Accounts persist across devices and refresh', 'تبقى الحسابات على جميع الأجهزة')}</li>
        </ul>
      </div>
    </div>
  );
}
