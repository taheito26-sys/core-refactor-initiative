import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, X, Loader2, Trash2, Edit2, ArrowLeftRight, BookOpen, HandCoins, ChevronDown, Pencil, Check } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/features/auth/auth-context";
import { useTheme } from "@/lib/theme-context";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { formatCustomerNumber } from "@/features/customer/customer-portal";
import { fmtTotal } from "@/lib/tracker-helpers";
import type { PublicStatement } from "@/features/stock/components/PublicStatementReport";

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

// 'YYYY-MM' in the viewer's own local timezone — toISOString() converts to
// UTC first, which rolls a payment timestamped just after local midnight
// (e.g. 12:01 AM on the 1st, in a timezone ahead of UTC) back into the
// previous month, silently misfiling it under the wrong month pill.
function localMonthKey(date: number | string): string {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

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

  const [tab, setTab] = useState<"payments" | "accounts">("payments");
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [depositModal, setDepositModal] = useState<{ account: Account; mode: "deposit" | "withdrawal" } | null>(null);
  const [transferModal, setTransferModal] = useState(false);
  const [clearPromptId, setClearPromptId] = useState<string | null>(null);
  // Ledger is no longer its own tab — it shows inline as a sub-section under
  // whichever account it belongs to, expanded on click.
  const [expandedLedgerAccountId, setExpandedLedgerAccountId] = useState<string | null>(null);
  const [editingNoteKey, setEditingNoteKey] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");

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

  // Payments received against this customer's loaned orders — same
  // USDT-free statement data /c/orders uses, surfaced here since it's real
  // money movement the customer should see on their Cash tab too.
  const { data: loanStatements = [] } = useQuery({
    queryKey: ["customer-cash-loan-statements", userId],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("customer-loan-statement", { method: "GET" });
      if (error || !data || (data as { error?: string }).error) return [];
      return (data as { statements: PublicStatement[] }).statements;
    },
    enabled: !!userId,
  });

  // Stable per-payment key (content-based, not array position) so a
  // customer's own note keeps attaching to the same payment across refetches.
  const loanPayments = useMemo(() => {
    const rows: { key: string; date: number; amount: number; currency: string; note: string | null; ref: string | null }[] = [];
    for (const s of loanStatements) {
      for (const p of s.payments) {
        rows.push({ key: `${s.currency}:${p.date}:${p.amount}`, date: p.date, amount: p.amount, currency: s.currency, note: p.note, ref: p.ref });
      }
    }
    return rows.sort((a, b) => b.date - a.date);
  }, [loanStatements]);

  // The customer's own note on a payment — independent of the merchant's
  // own note field on the same row, which the customer can't edit.
  const { data: paymentNotes = [] } = useQuery({
    queryKey: ["customer-payment-notes", userId],
    queryFn: async () => {
      if (!userId) return [];
      const { data, error } = await supabase.from("customer_payment_notes").select("payment_key, note").eq("user_id", userId);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!userId,
  });
  const paymentNoteByKey = useMemo(() => new Map(paymentNotes.map(n => [n.payment_key, n.note])), [paymentNotes]);

  const savePaymentNote = useMutation({
    mutationFn: async ({ key, note }: { key: string; note: string }) => {
      const { error } = await supabase.from("customer_payment_notes").upsert(
        { user_id: userId, payment_key: key, note },
        { onConflict: "user_id,payment_key" },
      );
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["customer-payment-notes", userId] }); },
    onError: (e: any) => toast.error(e?.message),
  });

  // Month filter. Payments are historical (they predate the portal for most
  // buyers), so defaulting to the calendar's current month — which the
  // Orders page does deliberately — would silently show an empty list for
  // anyone with no payment this month. Default instead to the most recent
  // month that actually has a payment, falling back to "All Months" only
  // once data has loaded and there's truly nothing.
  const [paymentsMonth, setPaymentsMonth] = useState<string | null>(null);
  const paymentsMonthInitialized = useRef(false);
  const paymentsMonths = useMemo(() => {
    const seen = new Set<string>();
    const months: string[] = [];
    for (const p of [...loanPayments].sort((a, b) => b.date - a.date)) {
      const key = localMonthKey(p.date);
      if (!seen.has(key)) { seen.add(key); months.push(key); }
    }
    return months;
  }, [loanPayments]);
  useEffect(() => {
    if (paymentsMonthInitialized.current || paymentsMonths.length === 0) return;
    paymentsMonthInitialized.current = true;
    const currentMonth = localMonthKey(Date.now());
    setPaymentsMonth(paymentsMonths.includes(currentMonth) ? currentMonth : paymentsMonths[0]);
  }, [paymentsMonths]);
  const filteredLoanPayments = useMemo(() =>
    paymentsMonth
      ? loanPayments.filter(p => localMonthKey(p.date) === paymentsMonth)
      : loanPayments,
    [loanPayments, paymentsMonth],
  );

  const loanTotals = useMemo(() => {
    let totalDebt = 0, totalPaid = 0, outstanding = 0;
    for (const s of loanStatements) { totalDebt += s.totalLoaned; totalPaid += s.totalRepaid; outstanding += s.outstanding; }
    const currency = loanStatements[0]?.currency ?? "QAR";
    return { totalDebt, totalPaid, outstanding, currency };
  }, [loanStatements]);

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

  // ── Per-account ledger with running balance — shown inline as a sub-list
  // under the account it belongs to, rather than as its own tab. ────────
  const getAccountLedgerWithRunning = (accountId: string) => {
    const rows = [...ledger].filter(e => e.account_id === accountId).reverse();
    let running = 0;
    const result = rows.map(e => {
      running += e.direction === "in" ? e.amount : -e.amount;
      return { ...e, running };
    });
    return result.reverse();
  };

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
            { id: "payments", icon: HandCoins, en: "Payments", ar: "الدفعات" },
            { id: "accounts", icon: BookOpen, en: "Accounts", ar: "الحسابات" },
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
                          <button onClick={() => setExpandedLedgerAccountId(id => id === acc.id ? null : acc.id)}
                            className="flex items-center gap-1 rounded-lg bg-muted px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-muted/80">
                            📋 {L("Ledger", "السجل")}
                            <ChevronDown className={cn("h-3 w-3 transition-transform", expandedLedgerAccountId === acc.id && "rotate-180")} />
                          </button>
                        </div>

                        {/* Ledger — shown inline as a sub-list under this account, not a separate tab */}
                        {expandedLedgerAccountId === acc.id && (
                          <div className="rounded-xl border border-border/50 bg-muted/20 overflow-hidden">
                            {getAccountLedgerWithRunning(acc.id).length === 0 ? (
                              <div className="px-4 py-6 text-center">
                                <p className="text-xs text-muted-foreground">{L("No ledger entries", "لا توجد حركات")}</p>
                              </div>
                            ) : (
                              <div className="divide-y divide-border/40">
                                {getAccountLedgerWithRunning(acc.id).map(e => {
                                  const typeLabel = LEDGER_TYPE_LABELS[e.type];
                                  return (
                                    <div key={e.id} className="flex items-center gap-3 px-3 py-2">
                                      <div className={cn("h-6 w-6 shrink-0 flex items-center justify-center rounded-full text-[10px] font-bold",
                                        e.direction === "in" ? "bg-emerald-500/10 text-emerald-600" : "bg-rose-500/10 text-rose-600")}>
                                        {e.direction === "in" ? "+" : "−"}
                                      </div>
                                      <div className="flex-1 min-w-0">
                                        <p className="text-[11px] font-semibold truncate">
                                          {typeLabel ? (lang === "ar" ? typeLabel.ar : typeLabel.en) : e.type}
                                          {e.note ? ` · ${e.note}` : ""}
                                        </p>
                                        <p className="text-[10px] text-muted-foreground">{new Date(e.ts).toLocaleString(lang === "ar" ? "ar-EG" : "en-US")}</p>
                                      </div>
                                      <div className="text-right shrink-0">
                                        <p className={cn("text-xs font-black tabular-nums", e.direction === "in" ? "text-emerald-600" : "text-rose-600")}>
                                          {e.direction === "in" ? "+" : "−"}{fmtTotal(e.amount)} {e.currency}
                                        </p>
                                        <p className="text-[9px] text-muted-foreground tabular-nums">{fmtTotal(e.running)} {e.currency}</p>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        )}

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


          {/* ── PAYMENTS TAB — payments received against loaned orders,
              same data the merchant's own Payments Received table shows,
              minus the account/edit/delete/merge actions (merchant-only). ── */}
          {tab === "payments" && (
            <div className="space-y-3">
              {/* Debt summary */}
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-2xl border border-border/50 bg-card p-3">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{L("Total Debt", "إجمالي المديونية")}</p>
                  <p className="text-lg font-black tabular-nums mt-0.5">{fmtTotal(loanTotals.totalDebt)} <span className="text-xs font-semibold text-muted-foreground">{loanTotals.currency}</span></p>
                </div>
                <div className="rounded-2xl border border-border/50 bg-card p-3">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{L("Paid", "المدفوع")}</p>
                  <p className="text-lg font-black tabular-nums mt-0.5 text-emerald-600">{fmtTotal(loanTotals.totalPaid)} <span className="text-xs font-semibold text-muted-foreground">{loanTotals.currency}</span></p>
                </div>
                <div className="rounded-2xl border border-border/50 bg-card p-3">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{L("Outstanding", "المتبقي")}</p>
                  <p className={cn("text-lg font-black tabular-nums mt-0.5", loanTotals.outstanding > 0 ? "text-amber-600" : "text-emerald-600")}>
                    {fmtTotal(loanTotals.outstanding)} <span className="text-xs font-semibold text-muted-foreground">{loanTotals.currency}</span>
                  </p>
                </div>
              </div>

              {/* Month filter — same convention as the Orders page */}
              {paymentsMonths.length > 0 && (
                <div className="month-filter-row">
                  <button onClick={() => setPaymentsMonth(null)} className={`month-pill ${paymentsMonth === null ? "active" : ""}`}>
                    {L("All Months", "كل الأشهر")}
                  </button>
                  {paymentsMonths.map(m => {
                    const [y, mo] = m.split("-");
                    const label = new Date(parseInt(y), parseInt(mo) - 1).toLocaleDateString(lang === "ar" ? "ar-EG" : "en-US", { month: "short", year: "2-digit" });
                    return (
                      <button key={m} onClick={() => setPaymentsMonth(m)} className={`month-pill ${paymentsMonth === m ? "active" : ""}`}>
                        {label}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Payments list */}
              <div className="rounded-2xl border border-border/60 bg-card overflow-hidden">
                <div className="px-4 py-3 border-b border-border/40 flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{L("Payments Received", "الدفعات المستلمة")}</p>
                  <span className="text-[10px] text-muted-foreground">{filteredLoanPayments.length} {L("payments", "دفعة")}</span>
                </div>
                {filteredLoanPayments.length === 0 ? (
                  <div className="px-6 py-10 text-center">
                    <p className="text-sm text-muted-foreground">{loanPayments.length === 0 ? L("No payments recorded yet", "لا توجد دفعات مسجلة بعد") : L("No payments this month", "لا توجد دفعات هذا الشهر")}</p>
                  </div>
                ) : (
                  <div className="divide-y divide-border/40">
                    {filteredLoanPayments.map(p => {
                      const myNote = paymentNoteByKey.get(p.key) ?? "";
                      const isEditingNote = editingNoteKey === p.key;
                      return (
                        <div key={p.key} className="px-4 py-2.5">
                          <div className="flex items-center gap-3">
                            <div className="h-7 w-7 shrink-0 flex items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 text-xs font-bold">+</div>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-semibold truncate">{new Date(p.date).toLocaleDateString(lang === "ar" ? "ar-EG" : "en-US", { year: "numeric", month: "short", day: "numeric" })}</p>
                              {p.note && <p className="text-[10px] text-muted-foreground truncate">{p.note}</p>}
                            </div>
                            <div className="text-right shrink-0">
                              <p className="text-sm font-black tabular-nums text-emerald-600">+{fmtTotal(p.amount)} {p.currency}</p>
                            </div>
                          </div>

                          {/* Customer's own note — separate from the merchant's note above */}
                          {isEditingNote ? (
                            <div className="mt-2 flex items-center gap-1.5 ps-10">
                              <input
                                autoFocus
                                value={noteDraft}
                                onChange={e => setNoteDraft(e.target.value)}
                                placeholder={L("Add a note...", "أضف ملاحظة...")}
                                onKeyDown={e => {
                                  if (e.key === "Enter") { savePaymentNote.mutate({ key: p.key, note: noteDraft.trim() }); setEditingNoteKey(null); }
                                  if (e.key === "Escape") setEditingNoteKey(null);
                                }}
                                className="h-8 flex-1 rounded-lg border border-border/50 bg-background px-2.5 text-xs outline-none focus:ring-2 focus:ring-primary/30"
                              />
                              <button
                                onClick={() => { savePaymentNote.mutate({ key: p.key, note: noteDraft.trim() }); setEditingNoteKey(null); }}
                                className="rounded-lg bg-primary p-1.5 text-primary-foreground"
                              >
                                <Check className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          ) : myNote ? (
                            <button
                              onClick={() => { setEditingNoteKey(p.key); setNoteDraft(myNote); }}
                              className="mt-1.5 flex items-center gap-1.5 ps-10 text-[10px] text-primary hover:underline"
                            >
                              <Pencil className="h-2.5 w-2.5 shrink-0" /> {myNote}
                            </button>
                          ) : (
                            <button
                              onClick={() => { setEditingNoteKey(p.key); setNoteDraft(""); }}
                              className="mt-1.5 flex items-center gap-1 ps-10 text-[10px] text-muted-foreground hover:text-primary"
                            >
                              <Plus className="h-2.5 w-2.5" /> {L("Add note", "أضف ملاحظة")}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
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
    </div>
  );
}
