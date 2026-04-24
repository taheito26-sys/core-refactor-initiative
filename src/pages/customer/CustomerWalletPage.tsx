import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, X, Loader2, Trash2, Edit2, ArrowLeftRight, RefreshCw, BookOpen, BarChart3 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/features/auth/auth-context";
import { useTheme } from "@/lib/theme-context";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { formatCustomerNumber } from "@/features/customer/customer-portal";
import { fmtTotal } from "@/lib/tracker-helpers";

// ── Types ─────────────────────────────────────────────────────────

type AccountType = "bank" | "mobile_wallet" | "cash" | "other";
type LedgerDirection = "in" | "out";

interface Account {
  id: string;
  user_id: string;
  name: string;
  type: AccountType;
  currency: string;
  status: string;
  created_at: string;
}

interface LedgerRow {
  id: string;
  user_id: string;
  account_id: string;
  contra_account_id: string | null;
  ts: number;
  type: string;
  direction: LedgerDirection;
  amount: number;
  currency: string;
  note: string | null;
  linked_entity_id: string | null;
  linked_entity_type: string | null;
  created_at: string;
}

// ── Helpers ───────────────────────────────────────────────────────

function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function getBalance(accountId: string, ledger: LedgerRow[]): number {
  return ledger
    .filter(e => e.account_id === accountId)
    .reduce((sum, e) => sum + (e.direction === "in" ? e.amount : -e.amount), 0);
}

function get24hMovement(accountId: string, ledger: LedgerRow[]): number {
  const cutoff = Date.now() - 86400000;
  return ledger
    .filter(e => e.account_id === accountId && e.ts >= cutoff)
    .reduce((sum, e) => sum + (e.direction === "in" ? e.amount : -e.amount), 0);
}

const ACCOUNT_TYPES: { value: AccountType; en: string; ar: string }[] = [
  { value: "bank", en: "Bank", ar: "بنك" },
  { value: "mobile_wallet", en: "Mobile Wallet", ar: "محفظة موبايل" },
  { value: "cash", en: "Cash in Hand", ar: "نقد باليد" },
  { value: "other", en: "Other", ar: "أخرى" },
];

const CURRENCIES = ["EGP", "QAR", "SAR", "AED", "USD", "USDT"];

const LEDGER_TYPE_LABELS: Record<string, { en: string; ar: string }> = {
  deposit: { en: "Deposit", ar: "إيداع" },
  withdrawal: { en: "Withdrawal", ar: "سحب" },
  transfer_in: { en: "Transfer In", ar: "تحويل وارد" },
  transfer_out: { en: "Transfer Out", ar: "تحويل صادر" },
  order_receipt: { en: "Order Receipt", ar: "استلام طلب" },
  reconcile: { en: "Reconcile", ar: "تسوية" },
  opening: { en: "Opening Balance", ar: "رصيد افتتاحي" },
};

// ── Deposit/Withdraw Modal ────────────────────────────────────────

function DepositWithdrawModal({ account, balance, mode, onSave, onClose, lang }: {
  account: Account; balance: number; mode: "deposit" | "withdrawal";
  onSave: (entry: Omit<LedgerRow, "user_id" | "created_at">) => void;
  onClose: () => void; lang: string;
}) {
  const L = (en: string, ar: string) => lang === "ar" ? ar : en;
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const amtNum = parseFloat(amount) || 0;
  const isIn = mode === "deposit";

  const handle = () => {
    if (!(amtNum > 0)) { setErr(L("Enter a valid amount", "أدخل مبلغاً صحيحاً")); return; }
    if (!isIn && amtNum > balance) { setErr(L(`Insufficient balance: ${fmtTotal(balance)} ${account.currency}`, `رصيد غير كافٍ: ${fmtTotal(balance)} ${account.currency}`)); return; }
    onSave({
      id: uid(), ts: Date.now(), type: mode, account_id: account.id,
      contra_account_id: null, direction: isIn ? "in" : "out",
      amount: amtNum, currency: account.currency,
      note: note.trim() || null, linked_entity_id: null, linked_entity_type: null,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md rounded-t-2xl bg-background p-5 pb-8 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <p className="font-bold text-sm">{isIn ? "➕" : "➖"} {isIn ? L("Deposit", "إيداع") : L("Withdrawal", "سحب")} — {account.name}</p>
          <button onClick={onClose} className="rounded-full p-1.5 hover:bg-muted"><X className="h-4 w-4" /></button>
        </div>
        <div className="rounded-lg bg-primary/10 px-3 py-2 text-sm">
          <span className="text-muted-foreground">{L("Current balance", "الرصيد الحالي")}: </span>
          <span className="font-black text-primary">{fmtTotal(balance)} {account.currency}</span>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">{L("Amount", "المبلغ")} ({account.currency})</label>
          <input autoFocus inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)}
            placeholder="0.00" className="h-11 w-full rounded-xl border border-border/50 bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-primary/30" />
        </div>
        {amtNum > 0 && (
          <p className="text-xs text-muted-foreground">
            {L("Balance after", "الرصيد بعد")}: <strong className={isIn ? "text-emerald-600" : "text-amber-600"}>{fmtTotal(balance + (isIn ? amtNum : -amtNum))} {account.currency}</strong>
          </p>
        )}
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">{L("Note (optional)", "ملاحظة (اختياري)")}</label>
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="..."
            className="h-10 w-full rounded-xl border border-border/50 bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-primary/30" />
        </div>
        {err && <p className="text-xs text-destructive">⚠ {err}</p>}
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 h-11 rounded-xl border border-border/50 text-sm font-semibold hover:bg-muted">{L("Cancel", "إلغاء")}</button>
          <button onClick={handle} className={cn("flex-1 h-11 rounded-xl text-sm font-bold text-white", isIn ? "bg-emerald-600 hover:bg-emerald-700" : "bg-amber-600 hover:bg-amber-700")}>
            {isIn ? L("Deposit", "إيداع") : L("Withdraw", "سحب")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Transfer Modal ────────────────────────────────────────────────

function TransferModal({ accounts, balances, onSave, onClose, lang }: {
  accounts: Account[]; balances: Map<string, number>;
  onSave: (out: Omit<LedgerRow, "user_id" | "created_at">, inn: Omit<LedgerRow, "user_id" | "created_at">) => void;
  onClose: () => void; lang: string;
}) {
  const L = (en: string, ar: string) => lang === "ar" ? ar : en;
  const active = accounts.filter(a => a.status === "active");
  const [fromId, setFromId] = useState(active[0]?.id || "");
  const [toId, setToId] = useState(active.find(a => a.id !== fromId)?.id || "");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const fromAcc = active.find(a => a.id === fromId);
  const toAcc = active.find(a => a.id === toId);
  const fromBal = balances.get(fromId) || 0;
  const amtNum = parseFloat(amount) || 0;

  const handle = () => {
    if (!fromId || !toId) { setErr(L("Select both accounts", "اختر كلا الحسابين")); return; }
    if (fromId === toId) { setErr(L("Cannot transfer to same account", "لا يمكن التحويل لنفس الحساب")); return; }
    if (!(amtNum > 0)) { setErr(L("Enter a valid amount", "أدخل مبلغاً صحيحاً")); return; }
    if (amtNum > fromBal) { setErr(L(`Insufficient: ${fmtTotal(fromBal)} ${fromAcc?.currency}`, `رصيد غير كافٍ: ${fmtTotal(fromBal)} ${fromAcc?.currency}`)); return; }
    const ts = Date.now();
    const base = { ts, amount: amtNum, currency: fromAcc!.currency, note: note.trim() || null, linked_entity_id: null, linked_entity_type: null };
    onSave(
      { ...base, id: uid(), type: "transfer_out", account_id: fromId, contra_account_id: toId, direction: "out", note: note.trim() || `Transfer to ${toAcc?.name}` },
      { ...base, id: uid(), type: "transfer_in", account_id: toId, contra_account_id: fromId, direction: "in", note: note.trim() || `Transfer from ${fromAcc?.name}` },
    );
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md rounded-t-2xl bg-background p-5 pb-8 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <p className="font-bold text-sm">⇄ {L("Transfer", "تحويل")}</p>
          <button onClick={onClose} className="rounded-full p-1.5 hover:bg-muted"><X className="h-4 w-4" /></button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">{L("From", "من")}</label>
            <select value={fromId} onChange={e => setFromId(e.target.value)}
              className="h-10 w-full rounded-lg border border-border/50 bg-card px-2 text-sm outline-none">
              {active.map(a => <option key={a.id} value={a.id}>{a.name} ({fmtTotal(balances.get(a.id) || 0)} {a.currency})</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">{L("To", "إلى")}</label>
            <select value={toId} onChange={e => setToId(e.target.value)}
              className="h-10 w-full rounded-lg border border-border/50 bg-card px-2 text-sm outline-none">
              {active.filter(a => a.id !== fromId).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">{L("Amount", "المبلغ")}</label>
          <input autoFocus inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)}
            placeholder="0.00" className="h-11 w-full rounded-xl border border-border/50 bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-primary/30" />
        </div>
        {amtNum > 0 && fromAcc && (
          <p className="text-xs text-muted-foreground">{fromAcc.name} {L("after", "بعد")}: <strong className="text-amber-600">{fmtTotal(fromBal - amtNum)} {fromAcc.currency}</strong></p>
        )}
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">{L("Note (optional)", "ملاحظة (اختياري)")}</label>
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="..."
            className="h-10 w-full rounded-xl border border-border/50 bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-primary/30" />
        </div>
        {err && <p className="text-xs text-destructive">⚠ {err}</p>}
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 h-11 rounded-xl border border-border/50 text-sm font-semibold hover:bg-muted">{L("Cancel", "إلغاء")}</button>
          <button onClick={handle} className="flex-1 h-11 rounded-xl bg-primary text-sm font-bold text-primary-foreground">{L("Transfer", "تحويل")}</button>
        </div>
      </div>
    </div>
  );
}

// ── Reconcile Modal ───────────────────────────────────────────────

function ReconcileModal({ account, balance, onSave, onClose, lang }: {
  account: Account; balance: number;
  onSave: (entry: Omit<LedgerRow, "user_id" | "created_at">) => void;
  onClose: () => void; lang: string;
}) {
  const L = (en: string, ar: string) => lang === "ar" ? ar : en;
  const [actual, setActual] = useState("");
  const [reason, setReason] = useState("");
  const [err, setErr] = useState("");
  const val = parseFloat(actual);

  const handle = () => {
    if (isNaN(val) || val < 0) { setErr(L("Enter actual balance", "أدخل الرصيد الفعلي")); return; }
    const diff = val - balance;
    onSave({
      id: uid(), ts: Date.now(), type: "reconcile", account_id: account.id,
      contra_account_id: null, direction: diff >= 0 ? "in" : "out",
      amount: Math.abs(diff), currency: account.currency,
      note: reason.trim() || `Reconciled. Balance: ${fmtTotal(val)}`,
      linked_entity_id: null, linked_entity_type: null,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl bg-background p-5 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <p className="font-bold text-sm">🔄 {L("Reconcile", "تسوية")} — {account.name}</p>
          <button onClick={onClose} className="rounded-full p-1.5 hover:bg-muted"><X className="h-4 w-4" /></button>
        </div>
        <p className="text-xs text-muted-foreground">{L("System balance", "الرصيد في النظام")}: <strong>{fmtTotal(balance)} {account.currency}</strong></p>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">{L("Actual physical balance", "الرصيد الفعلي")}</label>
          <input autoFocus inputMode="decimal" value={actual} onChange={e => setActual(e.target.value)}
            placeholder="0.00" className="h-11 w-full rounded-xl border border-border/50 bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-primary/30" />
        </div>
        {!isNaN(val) && val >= 0 && (
          <p className="text-xs text-muted-foreground">
            {L("Adjustment", "التعديل")}: <strong className={val - balance >= 0 ? "text-emerald-600" : "text-rose-600"}>{val - balance >= 0 ? "+" : ""}{fmtTotal(val - balance)} {account.currency}</strong>
          </p>
        )}
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">{L("Reason (optional)", "السبب (اختياري)")}</label>
          <input value={reason} onChange={e => setReason(e.target.value)} placeholder="..."
            className="h-10 w-full rounded-xl border border-border/50 bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-primary/30" />
        </div>
        {err && <p className="text-xs text-destructive">⚠ {err}</p>}
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 h-11 rounded-xl border border-border/50 text-sm font-semibold hover:bg-muted">{L("Cancel", "إلغاء")}</button>
          <button onClick={handle} className="flex-1 h-11 rounded-xl bg-primary text-sm font-bold text-primary-foreground">{L("Confirm", "تأكيد")}</button>
        </div>
      </div>
    </div>
  );
}

// ── Add/Edit Account Modal ────────────────────────────────────────

function AccountModal({ existing, onSave, onClose, lang }: {
  existing?: Account; onSave: (data: Partial<Account>) => void; onClose: () => void; lang: string;
}) {
  const L = (en: string, ar: string) => lang === "ar" ? ar : en;
  const [name, setName] = useState(existing?.name || "");
  const [type, setType] = useState<AccountType>(existing?.type || "bank");
  const [currency, setCurrency] = useState(existing?.currency || "EGP");
  const [err, setErr] = useState("");

  const handle = () => {
    if (!name.trim()) { setErr(L("Enter account name", "أدخل اسم الحساب")); return; }
    onSave({ name: name.trim(), type, currency });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md rounded-t-2xl bg-background p-5 pb-8 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <p className="font-bold text-sm">{existing ? L("Edit Account", "تعديل الحساب") : L("New Account", "حساب جديد")}</p>
          <button onClick={onClose} className="rounded-full p-1.5 hover:bg-muted"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">{L("Account Name", "اسم الحساب")}</label>
          <input autoFocus value={name} onChange={e => setName(e.target.value)}
            placeholder={L("e.g. My Bank Account", "مثل: حسابي البنكي")}
            className="h-11 w-full rounded-xl border border-border/50 bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-primary/30" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">{L("Type", "النوع")}</label>
            <select value={type} onChange={e => setType(e.target.value as AccountType)}
              className="h-10 w-full rounded-lg border border-border/50 bg-card px-2 text-sm outline-none">
              {ACCOUNT_TYPES.map(t => <option key={t.value} value={t.value}>{lang === "ar" ? t.ar : t.en}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">{L("Currency", "العملة")}</label>
            <select value={currency} onChange={e => setCurrency(e.target.value)}
              className="h-10 w-full rounded-lg border border-border/50 bg-card px-2 text-sm outline-none">
              {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
        {err && <p className="text-xs text-destructive">⚠ {err}</p>}
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 h-11 rounded-xl border border-border/50 text-sm font-semibold hover:bg-muted">{L("Cancel", "إلغاء")}</button>
          <button onClick={handle} className="flex-1 h-11 rounded-xl bg-primary text-sm font-bold text-primary-foreground">
            {existing ? L("Save", "حفظ") : L("Create", "إنشاء")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────

export default function CustomerWalletPage() {
  const { userId } = useAuth();
  const { settings } = useTheme();
  const qc = useQueryClient();
  const lang = settings.language;
  const L = (en: string, ar: string) => lang === "ar" ? ar : en;
  const fmt = (v: number, d = 0) => formatCustomerNumber(v, lang, d);

  const [tab, setTab] = useState<"accounts" | "ledger" | "insights">("accounts");
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [depositModal, setDepositModal] = useState<{ account: Account; mode: "deposit" | "withdrawal" } | null>(null);
  const [transferModal, setTransferModal] = useState(false);
  const [reconcileModal, setReconcileModal] = useState<Account | null>(null);
  const [ledgerFilter, setLedgerFilter] = useState<{ accountId: string; type: string }>({ accountId: "", type: "" });
  const [clearPromptId, setClearPromptId] = useState<string | null>(null);

  // ── Data ──────────────────────────────────────────────────────

  const { data: accounts = [], isLoading: accLoading } = useQuery({
    queryKey: ["customer-cash-accounts", userId],
    queryFn: async () => {
      if (!userId) return [] as Account[];
      const { data, error } = await supabase.from("cash_accounts").select("*").eq("user_id", userId).order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Account[];
    },
    enabled: !!userId,
  });

  const { data: ledger = [], isLoading: ledgerLoading } = useQuery({
    queryKey: ["customer-cash-ledger", userId],
    queryFn: async () => {
      if (!userId) return [] as LedgerRow[];
      const { data, error } = await supabase.from("cash_ledger").select("*").eq("user_id", userId).order("ts", { ascending: false });
      if (error) throw error;
      return (data ?? []) as LedgerRow[];
    },
    enabled: !!userId,
  });

  // Realtime
  useEffect(() => {
    if (!userId) return;
    const ch = supabase.channel(`c-wallet-${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "cash_accounts", filter: `user_id=eq.${userId}` }, () => {
        qc.invalidateQueries({ queryKey: ["customer-cash-accounts", userId] });
        qc.invalidateQueries({ queryKey: ["customer-cash-accounts-for-user", userId] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "cash_ledger", filter: `user_id=eq.${userId}` }, () => {
        qc.invalidateQueries({ queryKey: ["customer-cash-ledger", userId] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [userId, qc]);

  const activeAccounts = useMemo(() => accounts.filter(a => a.status === "active"), [accounts]);
  const balances = useMemo(() => {
    const m = new Map<string, number>();
    activeAccounts.forEach(a => m.set(a.id, getBalance(a.id, ledger)));
    return m;
  }, [activeAccounts, ledger]);

  const totalCash = useMemo(() => Array.from(balances.values()).reduce((s, v) => s + v, 0), [balances]);
  const movement24h = useMemo(() => activeAccounts.reduce((s, a) => s + get24hMovement(a.id, ledger), 0), [activeAccounts, ledger]);

  // ── Mutations ─────────────────────────────────────────────────

  const createAccount = useMutation({
    mutationFn: async (data: Partial<Account>) => {
      const newId = Math.random().toString(36).slice(2, 10);
      const { error } = await supabase.from("cash_accounts").insert({ id: newId, user_id: userId, ...data, status: "active", created_at: Date.now() });
      if (error) throw error;
    },
    onSuccess: () => { toast.success(L("Account created", "تم إنشاء الحساب")); qc.invalidateQueries({ queryKey: ["customer-cash-accounts", userId] }); qc.invalidateQueries({ queryKey: ["customer-cash-accounts-for-user", userId] }); },
    onError: (e: any) => toast.error(e?.message),
  });

  const updateAccount = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<Account> }) => {
      const { error } = await supabase.from("cash_accounts").update(data).eq("id", id).eq("user_id", userId);
      if (error) throw error;
    },
    onSuccess: () => { toast.success(L("Account updated", "تم التحديث")); qc.invalidateQueries({ queryKey: ["customer-cash-accounts", userId] }); },
    onError: (e: any) => toast.error(e?.message),
  });

  const deleteAccount = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("cash_accounts").update({ status: "inactive" }).eq("id", id).eq("user_id", userId);
      if (error) throw error;
    },
    onSuccess: () => { toast.success(L("Account removed", "تم الحذف")); qc.invalidateQueries({ queryKey: ["customer-cash-accounts", userId] }); },
    onError: (e: any) => toast.error(e?.message),
  });

  const addLedgerEntry = useMutation({
    mutationFn: async (entry: Omit<LedgerRow, "user_id" | "created_at">) => {
      const ledgerId = entry.id || Math.random().toString(36).slice(2, 10);
      const { error } = await supabase.from("cash_ledger").insert({ id: ledgerId, user_id: userId, ...entry });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["customer-cash-ledger", userId] }); },
    onError: (e: any) => toast.error(e?.message),
  });

  const clearLedger = useMutation({
    mutationFn: async (accountId: string) => {
      const { error } = await supabase.from("cash_ledger").delete().eq("account_id", accountId).eq("user_id", userId);
      if (error) throw error;
    },
    onSuccess: () => { toast.success(L("Ledger cleared", "تم مسح السجل")); qc.invalidateQueries({ queryKey: ["customer-cash-ledger", userId] }); setClearPromptId(null); },
    onError: (e: any) => toast.error(e?.message),
  });

  // ── Filtered ledger ───────────────────────────────────────────

  const filteredLedger = useMemo(() => ledger.filter(e => {
    if (ledgerFilter.accountId && e.account_id !== ledgerFilter.accountId) return false;
    if (ledgerFilter.type && e.type !== ledgerFilter.type) return false;
    return true;
  }), [ledger, ledgerFilter]);

  // ── Running balance for ledger tab ────────────────────────────

  const ledgerWithRunning = useMemo(() => {
    const rows = [...filteredLedger].reverse();
    let running = 0;
    const result = rows.map(e => {
      running += e.direction === "in" ? e.amount : -e.amount;
      return { ...e, running };
    });
    return result.reverse();
  }, [filteredLedger]);

  const isLoading = accLoading || ledgerLoading;

  return (
    <div className="space-y-0 pb-16">
      {/* ── Top summary bar ── */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b border-border/40 px-4 py-3 -mx-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-4">
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{L("Total Cash", "إجمالي النقد")}</p>
              <p className="text-xl font-black tabular-nums">{fmtTotal(totalCash)}</p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{L("Accounts", "الحسابات")}</p>
              <p className="text-xl font-black">{activeAccounts.length}</p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{L("24h Movement", "حركة 24س")}</p>
              <p className={cn("text-xl font-black tabular-nums", movement24h >= 0 ? "text-emerald-600" : "text-rose-600")}>
                {movement24h >= 0 ? "+" : ""}{fmtTotal(movement24h)}
              </p>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1">
          {([
            { id: "accounts", icon: BookOpen, en: "Accounts", ar: "الحسابات" },
            { id: "ledger", icon: RefreshCw, en: "Ledger", ar: "السجل" },
            { id: "insights", icon: BarChart3, en: "Insights", ar: "التحليل" },
          ] as const).map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={cn("flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
                tab === t.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}>
              <t.icon className="h-3.5 w-3.5" />
              {lang === "ar" ? t.ar : t.en}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : (
        <div className="px-4 pt-4">
          {/* ── ACCOUNTS TAB ── */}
          {tab === "accounts" && (
            <div className="space-y-3">
              {/* Action buttons */}
              <div className="flex gap-2">
                {activeAccounts.length >= 2 && (
                  <button onClick={() => setTransferModal(true)}
                    className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground">
                    <ArrowLeftRight className="h-3.5 w-3.5" />{L("Transfer", "تحويل")}
                  </button>
                )}
                <button onClick={() => setShowAddAccount(true)}
                  className="flex items-center gap-1.5 rounded-lg border border-border/50 px-3 py-2 text-xs font-semibold hover:bg-muted">
                  <Plus className="h-3.5 w-3.5" />{L("Add Account", "إضافة حساب")}
                </button>
              </div>

              {activeAccounts.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border/60 bg-card/30 px-6 py-12 text-center">
                  <p className="text-muted-foreground">{L("No accounts yet", "لا توجد حسابات بعد")}</p>
                  <button onClick={() => setShowAddAccount(true)} className="mt-3 flex items-center gap-2 mx-auto rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">
                    <Plus className="h-4 w-4" />{L("Add Account", "إضافة حساب")}
                  </button>
                </div>
              ) : (
                activeAccounts.map(acc => {
                  const bal = balances.get(acc.id) ?? 0;
                  const mv = get24hMovement(acc.id, ledger);
                  const accType = ACCOUNT_TYPES.find(t => t.value === acc.type);
                  return (
                    <div key={acc.id} className="rounded-2xl border border-border/60 bg-card overflow-hidden">
                      <div className="p-4 space-y-3">
                        {/* Account header */}
                        <div className="flex items-start justify-between">
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-bold">{acc.name}</span>
                              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                                {lang === "ar" ? accType?.ar : accType?.en}
                              </span>
                              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">{acc.currency}</span>
                              <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600">{L("active", "نشط")}</span>
                            </div>
                            <p className="text-[10px] text-muted-foreground mt-0.5">{L("Available Balance", "الرصيد المتاح")}</p>
                            <p className="text-2xl font-black tabular-nums mt-0.5">{fmtTotal(bal)} <span className="text-sm font-semibold text-muted-foreground">{acc.currency}</span></p>
                            {mv !== 0 && (
                              <p className={cn("text-[10px] mt-0.5", mv > 0 ? "text-emerald-600" : "text-rose-600")}>
                                {mv > 0 ? "+" : ""}{fmtTotal(mv)} {L("24h", "24س")}
                              </p>
                            )}
                          </div>
                          <div className="flex gap-1">
                            <button onClick={() => setEditingAccount(acc)} className="rounded-lg border border-border/50 p-2 hover:bg-muted" title={L("Edit", "تعديل")}>
                              <Edit2 className="h-3.5 w-3.5 text-muted-foreground" />
                            </button>
                            <button onClick={() => deleteAccount.mutate(acc.id)} className="rounded-lg border border-border/50 p-2 hover:bg-rose-500/10 hover:text-rose-600" title={L("Remove", "حذف")}>
                              <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                            </button>
                          </div>
                        </div>

                        {/* Action buttons */}
                        <div className="flex flex-wrap gap-1.5">
                          <button onClick={() => setDepositModal({ account: acc, mode: "deposit" })}
                            className="flex items-center gap-1 rounded-lg bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-500/20">
                            + {L("Deposit", "إيداع")}
                          </button>
                          <button onClick={() => setDepositModal({ account: acc, mode: "withdrawal" })}
                            className="flex items-center gap-1 rounded-lg bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-500/20">
                            − {L("Withdraw", "سحب")}
                          </button>
                          {activeAccounts.length >= 2 && (
                            <button onClick={() => setTransferModal(true)}
                              className="flex items-center gap-1 rounded-lg bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/20">
                              ⇄ {L("Transfer", "تحويل")}
                            </button>
                          )}
                          <button onClick={() => setReconcileModal(acc)}
                            className="flex items-center gap-1 rounded-lg bg-muted px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-muted/80">
                            ✓ {L("Reconcile", "تسوية")}
                          </button>
                          <button onClick={() => setTab("ledger")}
                            className="flex items-center gap-1 rounded-lg bg-muted px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-muted/80">
                            📋 {L("Ledger", "السجل")}
                          </button>
                        </div>

                        {/* Clear ledger */}
                        {clearPromptId === acc.id ? (
                          <div className="flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2">
                            <p className="flex-1 text-xs text-rose-600">{L("Clear all ledger entries for this account?", "مسح جميع سجلات هذا الحساب؟")}</p>
                            <button onClick={() => clearLedger.mutate(acc.id)} className="rounded-lg bg-rose-600 px-3 py-1 text-xs font-bold text-white">{L("Clear", "مسح")}</button>
                            <button onClick={() => setClearPromptId(null)} className="rounded-lg border border-border/50 px-3 py-1 text-xs font-semibold hover:bg-muted">{L("Cancel", "إلغاء")}</button>
                          </div>
                        ) : (
                          <button onClick={() => setClearPromptId(acc.id)}
                            className="flex items-center gap-1 text-[10px] text-rose-500 hover:text-rose-600">
                            🗑 {L("Clear Ledger", "مسح السجل")}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}

              {/* Add account card */}
              {activeAccounts.length > 0 && (
                <button onClick={() => setShowAddAccount(true)}
                  className="flex w-full flex-col items-center justify-center gap-1 rounded-2xl border border-dashed border-border/60 py-6 text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors">
                  <Plus className="h-5 w-5" />
                  <span className="text-xs font-semibold">{L("Add Account", "إضافة حساب")}</span>
                  <span className="text-[10px]">{L("Bank, wallet, or cash in hand", "بنك، محفظة، أو نقد باليد")}</span>
                </button>
              )}
            </div>
          )}

          {/* ── LEDGER TAB ── */}
          {tab === "ledger" && (
            <div className="space-y-3">
              {/* Filters */}
              <div className="flex gap-2 flex-wrap">
                <select value={ledgerFilter.accountId} onChange={e => setLedgerFilter(f => ({ ...f, accountId: e.target.value }))}
                  className="h-9 rounded-lg border border-border/50 bg-card px-2 text-xs outline-none">
                  <option value="">{L("All Accounts", "كل الحسابات")}</option>
                  {activeAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
                <select value={ledgerFilter.type} onChange={e => setLedgerFilter(f => ({ ...f, type: e.target.value }))}
                  className="h-9 rounded-lg border border-border/50 bg-card px-2 text-xs outline-none">
                  <option value="">{L("All Types", "كل الأنواع")}</option>
                  {Object.entries(LEDGER_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{lang === "ar" ? v.ar : v.en}</option>)}
                </select>
              </div>

              {ledgerWithRunning.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border/60 bg-card/30 px-6 py-10 text-center">
                  <p className="text-sm text-muted-foreground">{L("No ledger entries", "لا توجد حركات")}</p>
                </div>
              ) : (
                <div className="rounded-2xl border border-border/60 bg-card overflow-hidden">
                  <div className="divide-y divide-border/40">
                    {ledgerWithRunning.map(e => {
                      const acc = activeAccounts.find(a => a.id === e.account_id);
                      const typeLabel = LEDGER_TYPE_LABELS[e.type];
                      return (
                        <div key={e.id} className="flex items-center gap-3 px-4 py-2.5">
                          <div className={cn("h-7 w-7 shrink-0 flex items-center justify-center rounded-full text-xs font-bold",
                            e.direction === "in" ? "bg-emerald-500/10 text-emerald-600" : "bg-rose-500/10 text-rose-600")}>
                            {e.direction === "in" ? "+" : "−"}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold truncate">{acc?.name ?? e.account_id}</p>
                            <p className="text-[10px] text-muted-foreground truncate">
                              {typeLabel ? (lang === "ar" ? typeLabel.ar : typeLabel.en) : e.type}
                              {e.note ? ` · ${e.note}` : ""}
                            </p>
                            <p className="text-[10px] text-muted-foreground">{new Date(e.ts).toLocaleString(lang === "ar" ? "ar-EG" : "en-US")}</p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className={cn("text-sm font-black tabular-nums", e.direction === "in" ? "text-emerald-600" : "text-rose-600")}>
                              {e.direction === "in" ? "+" : "−"}{fmtTotal(e.amount)} {e.currency}
                            </p>
                            <p className="text-[10px] text-muted-foreground tabular-nums">{fmtTotal(e.running)} {e.currency}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── INSIGHTS TAB ── */}
          {tab === "insights" && (
            <div className="space-y-4">
              {/* Balance by account */}
              <div className="rounded-2xl border border-border/60 bg-card overflow-hidden">
                <div className="px-4 py-3 border-b border-border/40">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{L("Balance by Account", "الرصيد حسب الحساب")}</p>
                </div>
                {activeAccounts.map(acc => {
                  const bal = balances.get(acc.id) ?? 0;
                  const pct = totalCash > 0 ? (bal / totalCash) * 100 : 0;
                  return (
                    <div key={acc.id} className="px-4 py-3 border-b last:border-0 border-border/40">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-sm font-semibold">{acc.name}</span>
                        <span className="text-sm font-black tabular-nums">{fmtTotal(bal)} {acc.currency}</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-0.5">{pct.toFixed(1)}% {L("of total", "من الإجمالي")}</p>
                    </div>
                  );
                })}
              </div>

              {/* Transaction summary */}
              <div className="rounded-2xl border border-border/60 bg-card overflow-hidden">
                <div className="px-4 py-3 border-b border-border/40">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{L("Transaction Summary", "ملخص الحركات")}</p>
                </div>
                <div className="grid grid-cols-2 divide-x divide-border/40">
                  <div className="p-4">
                    <p className="text-[10px] text-muted-foreground mb-1">{L("Total In", "إجمالي الوارد")}</p>
                    <p className="text-lg font-black text-emerald-600 tabular-nums">
                      +{fmtTotal(ledger.filter(e => e.direction === "in").reduce((s, e) => s + e.amount, 0))}
                    </p>
                  </div>
                  <div className="p-4">
                    <p className="text-[10px] text-muted-foreground mb-1">{L("Total Out", "إجمالي الصادر")}</p>
                    <p className="text-lg font-black text-rose-600 tabular-nums">
                      −{fmtTotal(ledger.filter(e => e.direction === "out").reduce((s, e) => s + e.amount, 0))}
                    </p>
                  </div>
                </div>
              </div>

              {/* Order receipts */}
              {ledger.filter(e => e.type === "order_receipt").length > 0 && (
                <div className="rounded-2xl border border-border/60 bg-card overflow-hidden">
                  <div className="px-4 py-3 border-b border-border/40">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{L("Order Receipts", "استلامات الطلبات")}</p>
                  </div>
                  <div className="px-4 py-3">
                    <p className="text-2xl font-black text-emerald-600 tabular-nums">
                      +{fmtTotal(ledger.filter(e => e.type === "order_receipt").reduce((s, e) => s + e.amount, 0))} EGP
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {ledger.filter(e => e.type === "order_receipt").length} {L("orders received", "طلبات مستلمة")}
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Modals ── */}
      {showAddAccount && (
        <AccountModal lang={lang} onClose={() => setShowAddAccount(false)}
          onSave={data => { createAccount.mutate(data); }} />
      )}
      {editingAccount && (
        <AccountModal lang={lang} existing={editingAccount} onClose={() => setEditingAccount(null)}
          onSave={data => { updateAccount.mutate({ id: editingAccount.id, data }); }} />
      )}
      {depositModal && (
        <DepositWithdrawModal lang={lang} account={depositModal.account} mode={depositModal.mode}
          balance={balances.get(depositModal.account.id) ?? 0}
          onClose={() => setDepositModal(null)}
          onSave={entry => { addLedgerEntry.mutate(entry); toast.success(depositModal.mode === "deposit" ? L("Deposited", "تم الإيداع") : L("Withdrawn", "تم السحب")); }} />
      )}
      {transferModal && (
        <TransferModal lang={lang} accounts={activeAccounts} balances={balances}
          onClose={() => setTransferModal(false)}
          onSave={(out, inn) => {
            addLedgerEntry.mutate(out);
            addLedgerEntry.mutate(inn);
            toast.success(L("Transfer complete", "تم التحويل"));
          }} />
      )}
      {reconcileModal && (
        <ReconcileModal lang={lang} account={reconcileModal} balance={balances.get(reconcileModal.id) ?? 0}
          onClose={() => setReconcileModal(null)}
          onSave={entry => { addLedgerEntry.mutate(entry); toast.success(L("Reconciled", "تمت التسوية")); }} />
      )}
    </div>
  );
}
