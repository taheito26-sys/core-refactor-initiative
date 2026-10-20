import { statementQueryOptions } from "@/features/customer/statements-api";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, X, Loader2, Trash2, Edit2, ArrowLeftRight, BookOpen, HandCoins, ChevronDown, ChevronLeft, Pencil, Check, Minus, CalendarDays, Wallet2, Trophy, Search, ArrowUpDown, FileDown, FileSpreadsheet, Filter, CreditCard, Coins, List as ListIcon, FileText, Clock, CheckCircle2, XCircle, ChevronRight, MoreHorizontal, MessageSquare, Database } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/features/auth/auth-context";
import { useTheme } from "@/lib/theme-context";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { formatCustomerNumber } from "@/features/customer/customer-portal";
import { fmtTotal } from "@/lib/tracker-helpers";
import { QuickDateField } from "@/components/shared/QuickDateField";
import type { PublicStatement } from "@/features/stock/components/PublicStatementReport";
import { useMonthlyStatementExport } from "@/features/stock/utils/useMonthlyStatementExport";
import { useLoanPaymentClaims } from "@/hooks/useLoanPaymentClaims";
import { ModernSelect } from '@/components/shared/ModernSelect';

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

// Same local-timezone reasoning as localMonthKey, one level finer: several
// payments recorded on the same calendar day (a merchant splitting one
// physical handover into separate entries) should read as one payment to
// the customer, not a wall of near-identical rows.
function localDayKey(date: number | string): string {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

// The only two strings CashManagement's acceptPaymentClaim ever prefixes an
// accepted claim's note with (src/lib/i18n.ts customerReportedPayment) --
// checked directly rather than through a stored flag since the repayment
// itself is merchant tracker-state, not a relational row this page can add
// a column to.
const CUSTOMER_REPORTED_NOTE_PREFIXES = ['Customer-reported', 'أبلغ عنه العميل'];
function isCustomerReportedNote(note: string | null): boolean {
  if (!note) return false;
  return CUSTOMER_REPORTED_NOTE_PREFIXES.some(p => note.startsWith(p));
}

// The prefix above is an internal system label CashManagement.claimRepaymentNote
// stamps onto the repayment note when a claim is accepted -- it's never
// something the buyer themselves wrote, so it has no business showing up in
// their own note preview or, worse, sitting inside a note field they can
// then edit and resend.
function stripSystemNotePrefix(note: string | null): string | null {
  if (!note) return null;
  for (const prefix of CUSTOMER_REPORTED_NOTE_PREFIXES) {
    if (!note.startsWith(prefix)) continue;
    let rest = note.slice(prefix.length);
    if (rest.startsWith(':')) rest = rest.slice(1);
    rest = rest.trim();
    return rest && rest.toLowerCase() !== 'payment' ? rest : null;
  }
  return note;
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
            <ModernSelect value={fromId} onChange={e => setFromId(e.target.value)}
              className="h-10 w-full rounded-lg border border-border/50 bg-card px-2 text-sm outline-none">
              {active.map(a => <option key={a.id} value={a.id}>{a.name} ({fmtTotal(balances.get(a.id) || 0)} {a.currency})</option>)}
            </ModernSelect>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">{L("To", "إلى")}</label>
            <ModernSelect value={toId} onChange={e => setToId(e.target.value)}
              className="h-10 w-full rounded-lg border border-border/50 bg-card px-2 text-sm outline-none">
              {active.filter(a => a.id !== fromId).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </ModernSelect>
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
            <ModernSelect value={type} onChange={e => setType(e.target.value as AccountType)}
              className="h-10 w-full rounded-lg border border-border/50 bg-card px-2 text-sm outline-none">
              {ACCOUNT_TYPES.map(t => <option key={t.value} value={t.value}>{lang === "ar" ? t.ar : t.en}</option>)}
            </ModernSelect>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">{L("Currency", "العملة")}</label>
            <ModernSelect value={currency} onChange={e => setCurrency(e.target.value)}
              className="h-10 w-full rounded-lg border border-border/50 bg-card px-2 text-sm outline-none">
              {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
            </ModernSelect>
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

// ── Log a Loan Payment Modal ────────────────────────────────────────
// Reports a payment the customer made outside the app (bank transfer, cash,
// etc.) against one of their loans. This never touches the merchant's
// tracker directly -- it inserts a loan_payment_claims row the merchant
// reviews on their own device before it becomes a real repayment. See
// supabase/migrations/*_loan_payment_claims.sql for why.

interface StatementLinkOption {
  merchantUserId: string;
  customerId: string;
  currency: string;
}

function dateInputValue(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function LogPaymentModal({ links, existing, needsApproval, onSave, onClose, lang, saving }: {
  links: StatementLinkOption[];
  /** Present when correcting an already-submitted claim instead of logging a new one. */
  existing?: { id: string; currency: string; amount: number; note: string | null; paidAt: string };
  /** The claim was already accepted, so this edit is a request the merchant has to apply. */
  needsApproval?: boolean;
  onSave: (input: { merchantUserId: string; customerId: string; currency: string; amount: number; note?: string; paidAt: number }) => void;
  onClose: () => void; lang: string; saving: boolean;
}) {
  const L = (en: string, ar: string) => lang === "ar" ? ar : en;
  const [linkIndex, setLinkIndex] = useState(0);
  const [amount, setAmount] = useState(existing ? String(existing.amount) : "");
  const [note, setNote] = useState(existing?.note || "");
  const [dateStr, setDateStr] = useState(dateInputValue(existing ? new Date(existing.paidAt).getTime() : Date.now()));
  const [err, setErr] = useState("");
  const link = links[linkIndex];
  const amtNum = parseFloat(amount) || 0;

  const handle = () => {
    if (!existing && !link) { setErr(L("No linked loan found", "لا يوجد قرض مرتبط")); return; }
    if (!(amtNum > 0)) { setErr(L("Enter a valid amount", "أدخل مبلغاً صحيحاً")); return; }
    const paidAt = new Date(`${dateStr}T00:00:00`).getTime();
    if (!Number.isFinite(paidAt)) { setErr(L("Enter a valid date", "أدخل تاريخاً صحيحاً")); return; }
    onSave({
      merchantUserId: link?.merchantUserId ?? "",
      customerId: link?.customerId ?? "",
      currency: existing?.currency ?? link!.currency,
      amount: amtNum,
      note: note.trim() || undefined,
      paidAt,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md rounded-t-2xl bg-background p-5 pb-8 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <p className="font-bold text-sm">💸 {existing ? L("Edit Payment", "تعديل الدفعة") : L("Log a Payment", "تسجيل دفعة")}</p>
          <button onClick={onClose} className="rounded-full p-1.5 hover:bg-muted"><X className="h-4 w-4" /></button>
        </div>
        {!existing && (
          <p className="text-xs text-muted-foreground">
            {L(
              "Tell your merchant you paid them outside the app. They'll confirm it before it's applied.",
              "أخبر تاجرك أنك دفعت له خارج التطبيق. سيقوم بتأكيدها قبل تطبيقها.",
            )}
          </p>
        )}
        {needsApproval && (
          <p className="text-xs text-muted-foreground">
            {L(
              "Your merchant already confirmed this payment, so your correction goes to them for review.",
              "تاجرك أكد هذه الدفعة بالفعل، لذا سيُرسل تعديلك إليه للمراجعة.",
            )}
          </p>
        )}
        {!existing && links.length > 1 && (
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">{L("Currency", "العملة")}</label>
            <ModernSelect value={linkIndex} onChange={e => setLinkIndex(Number(e.target.value))}
              className="h-10 w-full rounded-lg border border-border/50 bg-card px-2 text-sm outline-none">
              {links.map((l, i) => <option key={`${l.merchantUserId}-${l.currency}`} value={i}>{l.currency}</option>)}
            </ModernSelect>
          </div>
        )}
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">{L("Amount", "المبلغ")} {existing?.currency || link ? `(${existing?.currency ?? link?.currency})` : ""}</label>
          <input autoFocus inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)}
            placeholder="0.00" className="h-11 w-full rounded-xl border border-border/50 bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-primary/30" />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">{L("Date paid", "تاريخ الدفع")}</label>
          <QuickDateField value={dateStr} onChange={setDateStr} lang={lang === "ar" ? "ar" : "en"} />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">{L("Note (optional)", "ملاحظة (اختياري)")}</label>
          <input value={note} onChange={e => setNote(e.target.value)} placeholder={L("e.g. bank transfer ref #1234", "مثل: تحويل بنكي رقم 1234")}
            className="h-10 w-full rounded-xl border border-border/50 bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-primary/30" />
        </div>
        {err && <p className="text-xs text-destructive">⚠ {err}</p>}
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 h-11 rounded-xl border border-border/50 text-sm font-semibold hover:bg-muted">{L("Cancel", "إلغاء")}</button>
          <button onClick={handle} disabled={saving} className="flex-1 h-11 rounded-xl bg-primary text-sm font-bold text-primary-foreground disabled:opacity-60">
            {saving ? <Loader2 className="mx-auto h-4 w-4 animate-spin" />
              : needsApproval ? L("Send request", "إرسال الطلب")
              : existing ? L("Save", "حفظ") : L("Submit", "إرسال")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────

// ── Payments card styling ─────────────────────────────────────────

const PAYMENT_STATUS_STYLES = {
  completed: { bar: "bg-emerald-500", pill: "bg-emerald-500/15 text-emerald-600", amount: "text-emerald-600", Icon: CheckCircle2, label: (L: (en: string, ar: string) => string) => L("Completed", "مكتمل") },
  pending: { bar: "bg-amber-500", pill: "bg-blue-500/15 text-blue-600", amount: "text-amber-600", Icon: Clock, label: (L: (en: string, ar: string) => string) => L("Processing", "قيد المعالجة") },
  rejected: { bar: "bg-rose-500", pill: "bg-rose-500/15 text-rose-600", amount: "text-rose-600", Icon: XCircle, label: (L: (en: string, ar: string) => string) => L("Not confirmed", "غير مؤكدة") },
} as const;

// Illustration for the banner: a checklist clipboard, a parcel and a rising arrow.
function PaymentsBannerArt({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 240 170" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="bannerBoard" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#c7d2fe" />
        </linearGradient>
        <linearGradient id="bannerClip" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6366f1" />
          <stop offset="1" stopColor="#4338ca" />
        </linearGradient>
        <linearGradient id="bannerArrow" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#10b981" />
          <stop offset="1" stopColor="#6ee7b7" />
        </linearGradient>
      </defs>
      <ellipse cx="120" cy="150" rx="105" ry="16" fill="#38bdf8" opacity="0.45" />
      <ellipse cx="120" cy="146" rx="80" ry="10" fill="#0ea5e9" opacity="0.5" />
      {/* parcel */}
      <g>
        <polygon points="12,96 44,84 76,96 44,110" fill="#fde68a" />
        <polygon points="12,96 44,110 44,142 12,128" fill="#f59e0b" />
        <polygon points="76,96 44,110 44,142 76,128" fill="#fbbf24" />
        <polygon points="38,88 50,84 82,97 70,101" fill="#fff7ed" opacity="0.8" />
      </g>
      {/* clipboard */}
      <g transform="rotate(9 130 78)">
        <rect x="82" y="22" width="102" height="124" rx="14" fill="url(#bannerClip)" />
        <rect x="90" y="32" width="86" height="106" rx="9" fill="url(#bannerBoard)" />
        <rect x="114" y="14" width="38" height="20" rx="8" fill="#4338ca" />
        <circle cx="133" cy="21" r="4" fill="#c7d2fe" />
        {[50, 77, 104].map(y => (
          <g key={y}>
            <rect x="99" y={y} width="17" height="17" rx="5" fill="#3b82f6" />
            <path d={`M103 ${y + 8.5} l4 4 l6 -8`} fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
            <rect x="124" y={y + 3} width="44" height="5" rx="2.5" fill="#818cf8" />
            <rect x="124" y={y + 11} width="30" height="4" rx="2" fill="#c7d2fe" />
          </g>
        ))}
      </g>
      {/* parcel behind-right */}
      <g>
        <polygon points="178,104 204,94 230,104 204,116" fill="#fde68a" />
        <polygon points="178,104 204,116 204,142 178,130" fill="#f59e0b" />
        <polygon points="230,104 204,116 204,142 230,130" fill="#fbbf24" />
      </g>
      {/* rising arrow */}
      <path d="M172 62 L196 40 L206 50" fill="none" stroke="url(#bannerArrow)" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />
      <polygon points="190,30 224,22 214,56" fill="#10b981" />
      {/* confirm badge */}
      <circle cx="90" cy="138" r="19" fill="#10b981" stroke="#d1fae5" strokeWidth="4" />
      <path d="M81 138 l7 7 l12 -14" fill="none" stroke="#fff" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

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
  const [showLogPayment, setShowLogPayment] = useState(false);
  const [editingClaimId, setEditingClaimId] = useState<string | null>(null);
  const [deleteClaimPromptId, setDeleteClaimPromptId] = useState<string | null>(null);
  // Same edit/delete flow as above, but for a payment the merchant entered
  // directly -- see merchantPaymentClaimByBucket.
  const [editingMerchantPayment, setEditingMerchantPayment] = useState<{ bucket: string; currency: string; amount: number; date: number; note: string | null } | null>(null);
  // Shared between the "added by me" and "added by merchant" correction
  // flows below -- keyed by the payment row's own key, not a claim id,
  // since a merchant-added row has no claim until a request creates one.
  const [deletePaymentPromptKey, setDeletePaymentPromptKey] = useState<string | null>(null);
  // Which payment row's "Details" toggle is expanded — shows the fields
  // already on the row (exact time, currency, how many payments folded
  // into this day's group) that don't fit the collapsed line.
  const [expandedPaymentKey, setExpandedPaymentKey] = useState<string | null>(null);

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
  // money movement the customer should see on their Cash tab too. Same key
  // as CustomerHomePage/CustomerOrdersPage's identical edge-function call
  // (same invoke, no params) so all three pages share one cached fetch
  // instead of each independently invoking and polling the (comparatively
  // heavy, server-side tracker-state-walking) edge function on its own.
  const { data: loanStatements = [] } = useQuery({
    ...statementQueryOptions<PublicStatement>('plain', userId),
    refetchInterval: 45000,
  });

  // Which (merchant, customer_id, currency) loans this customer is
  // authorized to log a payment against -- the same buyer_statement_links
  // rows that already gate their read-only loan statement above.
  const { data: statementLinks = [] } = useQuery({
    queryKey: ["customer-statement-links", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("buyer_statement_links")
        .select("user_id, customer_id, currency")
        .eq("customer_user_id", userId)
        .is("revoked_at", null);
      if (error) {
        console.warn("[CustomerWalletPage] statement-links query error:", error.message);
        return [];
      }
      return (data ?? []).map(l => ({ merchantUserId: l.user_id, customerId: l.customer_id, currency: l.currency }));
    },
    enabled: !!userId,
  });

  const {
    claims: myPaymentClaims, submitClaim, updateClaim, deleteClaim, requestChange,
    requestMerchantPaymentChange, cancelMerchantPaymentChange,
  } = useLoanPaymentClaims("customer");
  const editingClaim = myPaymentClaims.find(c => c.id === editingClaimId) || null;
  // Once a claim is accepted it becomes a real repayment on the merchant's
  // tracker and already appears in the unified "Payments Received" list
  // below (tagged "Added by me") -- keeping it here too would show the same
  // money twice under two different headings. A withdrawn one is gone from
  // both.
  const unsettledPaymentClaims = useMemo(
    () => myPaymentClaims.filter(c => c.status === "pending" || c.status === "rejected"),
    [myPaymentClaims],
  );

  // Which accepted claim produced which row of the payments list. Payment
  // rows are never merged (see groupedLoanPayments below), so a claim is
  // matched back to its exact row by currency + timestamp + amount -- the
  // same identity loanPayments itself keys by -- rather than by day, which
  // used to collapse two same-day payments into one ambiguous row.
  const claimByPaymentBucket = useMemo(() => {
    const map = new Map<string, typeof myPaymentClaims[number]>();
    for (const c of myPaymentClaims) {
      if (c.status !== "accepted") continue;
      map.set(`${c.currency}:${c.paidAt}:${c.amount}`, c);
    }
    return map;
  }, [myPaymentClaims]);

  // A payment the *merchant* entered directly has no claim of its own --
  // correcting or removing it goes through request_merchant_payment_correction
  // instead, which stages a claim row (source: 'merchant_payment') just to
  // carry the request. Keyed the same exact-identity way.
  const merchantPaymentClaimByBucket = useMemo(() => {
    const map = new Map<string, typeof myPaymentClaims[number]>();
    for (const c of myPaymentClaims) {
      if (c.source !== "merchant_payment") continue;
      map.set(`${c.currency}:${c.paidAt}:${c.amount}`, c);
    }
    return map;
  }, [myPaymentClaims]);

  // Stable per-payment key (content-based, not array position) so a
  // customer's own note keeps attaching to the same payment across refetches.
  const loanPayments = useMemo(() => {
    const rows: { key: string; date: number; amount: number; currency: string; note: string | null; ref: string | null; addedByCustomer: boolean }[] = [];
    for (const s of loanStatements) {
      for (const p of s.payments) {
        rows.push({ key: `${s.currency}:${p.date}:${p.amount}`, date: p.date, amount: p.amount, currency: s.currency, note: stripSystemNotePrefix(p.note), ref: p.ref, addedByCustomer: isCustomerReportedNote(p.note) });
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
  const [paymentsMonth, setPaymentsMonth] = useState<string | null>(() => localMonthKey(Date.now()));
  const userPickedPaymentsMonth = useRef(false);
  const paymentsMonths = useMemo(() => {
    const seen = new Set<string>();
    const months: string[] = [];
    for (const p of [...loanPayments].sort((a, b) => b.date - a.date)) {
      const key = localMonthKey(p.date);
      if (!seen.has(key)) { seen.add(key); months.push(key); }
    }
    return months;
  }, [loanPayments]);
  // Re-evaluates every time paymentsMonths changes rather than once on
  // mount: the loan-statement edge function can resolve after this first
  // renders, so the first non-empty paymentsMonths list can still be
  // missing the most recent month. Locking the fallback in at that point
  // meant a newer month with a payment stayed hidden even after that data
  // arrived on a later poll. Skipped once the buyer has picked a month.
  useEffect(() => {
    if (userPickedPaymentsMonth.current || paymentsMonths.length === 0) return;
    const currentMonth = localMonthKey(Date.now());
    const next = paymentsMonths.includes(currentMonth) ? currentMonth : paymentsMonths[0];
    setPaymentsMonth(prev => (prev === next ? prev : next));
  }, [paymentsMonths]);
  const filteredLoanPayments = useMemo(() =>
    paymentsMonth
      ? loanPayments.filter(p => localMonthKey(p.date) === paymentsMonth)
      : loanPayments,
    [loanPayments, paymentsMonth],
  );

  // One row per payment -- never merged. Same-day payments used to be
  // summed into a single row keyed by day + currency, but that made Edit/
  // Delete impossible whenever two payments landed on the same day (no way
  // to tell which one a request was aimed at). Each row's "bucket" is the
  // payment's own exact identity (currency + timestamp + amount), matching
  // how claimByPaymentBucket/merchantPaymentClaimByBucket above resolve it.
  const groupedLoanPayments = useMemo(() =>
    filteredLoanPayments.map(p => ({
      key: p.key,
      bucket: p.key,
      date: p.date,
      amount: p.amount,
      currency: p.currency,
      note: p.note,
      addedByCustomer: p.addedByCustomer,
    })),
    [filteredLoanPayments],
  );

  // A stable "#N" the buyer can reference in chat/calls, one per payment,
  // restarting at #1 each calendar month — same convention as the Orders
  // page's sequence numbers. Built from the full, unfiltered loanPayments
  // (not the month-filtered groupedLoanPayments) so a payment's number
  // never depends on which month filter is active.
  const paymentSequence = useMemo(() => {
    const sorted = [...loanPayments].sort((a, b) => a.date - b.date);
    const map = new Map<string, number>();
    const countByMonth = new Map<string, number>();
    for (const p of sorted) {
      const monthKey = localMonthKey(p.date);
      const next = (countByMonth.get(monthKey) ?? 0) + 1;
      countByMonth.set(monthKey, next);
      map.set(p.key, next);
    }
    return map;
  }, [loanPayments]);

  // Search + sort controls for the Payments Received list — lets the buyer
  // find a specific payment by its note instead of scrolling the whole
  // month, and re-order it (newest/oldest/largest/smallest) rather than
  // being stuck with insertion order.
  const [paymentSearch, setPaymentSearch] = useState("");
  const [paymentSort, setPaymentSort] = useState<"date_desc" | "date_asc" | "amount_desc" | "amount_asc">("date_desc");

  // Day + amount-range filter — separate from the month pills above (those
  // narrow to a whole month; this narrows further, to one specific day
  // and/or an amount bracket, for a buyer trying to find one payment they
  // half-remember the size or date of).
  const [showPaymentFilter, setShowPaymentFilter] = useState(false);
  const [paymentFilterDay, setPaymentFilterDay] = useState("");
  const [paymentFilterMinAmount, setPaymentFilterMinAmount] = useState("");
  const [paymentFilterMaxAmount, setPaymentFilterMaxAmount] = useState("");
  // Whether the remembered day/amount criteria above are currently being
  // applied. Kept separate from the criteria themselves so a single tap on
  // the Filter chip can flip filtering on/off without losing what was
  // configured — the buyer re-enables the same filter with one tap instead
  // of re-entering it.
  const [paymentFilterOn, setPaymentFilterOn] = useState(false);
  const hasPaymentFilterCriteria = !!(paymentFilterDay || paymentFilterMinAmount || paymentFilterMaxAmount);
  const activePaymentFilterCount = paymentFilterOn && hasPaymentFilterCriteria ? 1 : 0;

  const displayedLoanPayments = useMemo(() => {
    const q = paymentSearch.trim().toLowerCase();
    const minAmount = paymentFilterMinAmount.trim() ? parseFloat(paymentFilterMinAmount) : null;
    const maxAmount = paymentFilterMaxAmount.trim() ? parseFloat(paymentFilterMaxAmount) : null;
    const filtered = groupedLoanPayments.filter(p => {
      if (q && !(p.note ?? "").toLowerCase().includes(q)) return false;
      if (paymentFilterOn) {
        if (paymentFilterDay && localDayKey(p.date) !== paymentFilterDay) return false;
        if (minAmount != null && Number.isFinite(minAmount) && p.amount < minAmount) return false;
        if (maxAmount != null && Number.isFinite(maxAmount) && p.amount > maxAmount) return false;
      }
      return true;
    });
    const sorted = [...filtered];
    sorted.sort((a, b) => {
      switch (paymentSort) {
        case "date_asc": return a.date - b.date;
        case "amount_desc": return b.amount - a.amount;
        case "amount_asc": return a.amount - b.amount;
        default: return b.date - a.date;
      }
    });
    return sorted;
  }, [groupedLoanPayments, paymentSearch, paymentSort, paymentFilterOn, paymentFilterDay, paymentFilterMinAmount, paymentFilterMaxAmount]);
  const displayedLoanPaymentsTotal = useMemo(
    () => displayedLoanPayments.reduce((sum, p) => sum + p.amount, 0),
    [displayedLoanPayments],
  );

  // ── Card-list view model ──────────────────────────────────────
  // Registered payments and the buyer's still-unsettled reports share one
  // list so every card can carry a status: registered = completed, a report
  // awaiting the merchant = pending, a report the merchant did not confirm =
  // rejected.
  const [statusFilter, setStatusFilter] = useState<"all" | "completed" | "pending" | "rejected">("all");
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [menuRowKey, setMenuRowKey] = useState<string | null>(null);

  const numLocale = lang === "ar" ? "ar-u-nu-latn" : "en-GB";
  const cardDateLabel = (ts: number) => new Date(ts).toLocaleDateString(numLocale, { day: "numeric", month: "long", year: "numeric" });
  const cardTimeLabel = (ts: number) => new Date(ts).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
  const monthPillLabel = (key: string) => {
    const [y, mo] = key.split("-");
    return `${new Date(parseInt(y), parseInt(mo) - 1).toLocaleDateString(numLocale, { month: "long" })} ${y.slice(2)}`;
  };

  type PaymentRow = {
    kind: "payment" | "claim";
    key: string;
    status: "completed" | "pending" | "rejected";
    date: number;
    amount: number;
    currency: string;
    note: string | null;
    addedByCustomer: boolean;
    payment: (typeof groupedLoanPayments)[number] | null;
    claim: (typeof myPaymentClaims)[number] | null;
  };

  const paymentRows = useMemo<PaymentRow[]>(() => {
    const q = paymentSearch.trim().toLowerCase();
    const minAmount = paymentFilterMinAmount.trim() ? parseFloat(paymentFilterMinAmount) : null;
    const maxAmount = paymentFilterMaxAmount.trim() ? parseFloat(paymentFilterMaxAmount) : null;
    const rows: PaymentRow[] = displayedLoanPayments.map(p => ({
      kind: "payment", key: p.key, status: "completed", date: p.date, amount: p.amount, currency: p.currency,
      note: p.note, addedByCustomer: p.addedByCustomer, payment: p, claim: null,
    }));
    for (const c of unsettledPaymentClaims) {
      if (paymentsMonth && localMonthKey(c.paidAt) !== paymentsMonth) continue;
      if (q && !(c.note ?? "").toLowerCase().includes(q)) continue;
      if (paymentFilterOn) {
        if (paymentFilterDay && localDayKey(c.paidAt) !== paymentFilterDay) continue;
        if (minAmount != null && Number.isFinite(minAmount) && c.amount < minAmount) continue;
        if (maxAmount != null && Number.isFinite(maxAmount) && c.amount > maxAmount) continue;
      }
      rows.push({
        kind: "claim", key: `claim:${c.id}`, status: c.status === "pending" ? "pending" : "rejected",
        date: new Date(c.paidAt).getTime(), amount: c.amount, currency: c.currency, note: c.note, addedByCustomer: true, payment: null, claim: c,
      });
    }
    rows.sort((a, b) => {
      switch (paymentSort) {
        case "date_asc": return a.date - b.date;
        case "amount_desc": return b.amount - a.amount;
        case "amount_asc": return a.amount - b.amount;
        default: return b.date - a.date;
      }
    });
    return rows;
  }, [displayedLoanPayments, unsettledPaymentClaims, paymentsMonth, paymentSearch, paymentSort, paymentFilterOn, paymentFilterDay, paymentFilterMinAmount, paymentFilterMaxAmount]);

  const statusCounts = useMemo(() => {
    const counts = { all: paymentRows.length, completed: 0, pending: 0, rejected: 0 };
    for (const r of paymentRows) counts[r.status] += 1;
    return counts;
  }, [paymentRows]);
  const visibleRows = useMemo(
    () => (statusFilter === "all" ? paymentRows : paymentRows.filter(r => r.status === statusFilter)),
    [paymentRows, statusFilter],
  );

  // Headline counters cover everything the buyer has ever reported, not the
  // month/search narrowing the list below applies.
  const overallCounts = useMemo(() => {
    const pending = unsettledPaymentClaims.filter(c => c.status === "pending").length;
    const rejected = unsettledPaymentClaims.length - pending;
    const completed = loanPayments.length;
    return { total: completed + pending + rejected, completed, pending, rejected };
  }, [loanPayments, unsettledPaymentClaims]);


  // Resolves how a registered payment can be corrected: through the claim the
  // buyer submitted, or through a request staged against the merchant's entry.
  const resolveCorrection = (p: (typeof groupedLoanPayments)[number]) => {
                      // A payment this customer submitted through the claim
                      // flow can be changed via that claim, through the
                      // merchant: it's their tracker that holds the repayment.
                      const ownClaim = p.addedByCustomer ? claimByPaymentBucket.get(p.bucket) : undefined;
                      // Fallback for everything else -- a payment the
                      // merchant entered directly, but *also* a "Added by
                      // me" row whose note carries the "Customer-reported"
                      // prefix without a resolvable claim behind it (e.g.
                      // one entered before the claims table existed, or
                      // whose claim was otherwise deleted): either way
                      // there's no claim id to hang a request on, so it
                      // goes through the same generic single-payment
                      // correction path merchant-entered rows use. Rows are
                      // never merged (see groupedLoanPayments above), so `p`
                      // already *is* the one exact payment this row
                      // represents -- no separate lookup needed.
                      const merchantSingle = !ownClaim ? p : undefined;
                      const merchantRequest = !ownClaim ? merchantPaymentClaimByBucket.get(p.bucket) : undefined;
                      const merchantLink = merchantSingle ? statementLinks.find(l => l.currency === p.currency) : undefined;

                      // Unifies the two correction flows (a claim the
                      // customer submitted vs. a request staged fresh
                      // against a merchant-entered payment) into one shape,
                      // so the action row below doesn't have to branch on
                      // which one it's rendering.
                      const correction = ownClaim
                        ? {
                            changeRequest: ownClaim.changeRequest,
                            onEdit: () => setEditingClaimId(ownClaim.id),
                            onRequestDelete: () => requestChange.mutate({ id: ownClaim.id, kind: "delete" }),
                            onCancelRequest: () => requestChange.mutate({ id: ownClaim.id, kind: null }),
                          }
                        : merchantSingle && merchantLink
                        ? {
                            changeRequest: merchantRequest?.changeRequest ?? null,
                            onEdit: () => setEditingMerchantPayment({ bucket: p.bucket, currency: p.currency, amount: merchantSingle.amount, date: merchantSingle.date, note: merchantSingle.note }),
                            onRequestDelete: () => requestMerchantPaymentChange.mutate({
                              merchantUserId: merchantLink.merchantUserId, customerId: merchantLink.customerId,
                              currency: p.currency, amount: merchantSingle.amount, paidAt: merchantSingle.date,
                              kind: "delete",
                            }),
                            onCancelRequest: () => merchantRequest && cancelMerchantPaymentChange.mutate(merchantRequest.id),
                          }
                        : null;
    return correction;
  };

  const loanTotals = useMemo(() => {
    let totalDebt = 0, totalPaid = 0, outstanding = 0;
    for (const s of loanStatements) { totalDebt += s.totalLoaned; totalPaid += s.totalRepaid; outstanding += s.outstanding; }
    const currency = loanStatements[0]?.currency ?? "QAR";
    const settledPct = totalDebt > 0 ? Math.min(100, Math.round((totalPaid / totalDebt) * 100)) : 0;
    return { totalDebt, totalPaid, outstanding, currency, settledPct };
  }, [loanStatements]);

  // Monthly statement export — pulls the branded, month-scoped statement
  // (own cumulative totals + payment history, plus the merchant's month-wide
  // EGP sell ledger) straight from the server, so a buyer can self-serve the
  // same document a merchant would otherwise have to generate and send by
  // hand. Saves a real PDF or XLSX file directly — no print dialog.
  const { exportingFormat, exportStatement } = useMonthlyStatementExport(loanTotals.currency, L);

  // Per-month totals — every month that has ever had a payment, newest
  // first, so "how am I doing this month vs last" is visible without
  // stepping through the month filter one pill at a time.
  const monthlyPaymentBreakdown = useMemo(() => {
    const map = new Map<string, { key: string; total: number; count: number; currency: string }>();
    for (const p of loanPayments) {
      const mk = localMonthKey(p.date);
      let m = map.get(mk);
      if (!m) { m = { key: mk, total: 0, count: 0, currency: p.currency }; map.set(mk, m); }
      m.total = Math.round((m.total + p.amount) * 100) / 100;
      m.count += 1;
    }
    return Array.from(map.values()).sort((a, b) => b.key.localeCompare(a.key));
  }, [loanPayments]);
  const maxMonthlyTotal = useMemo(
    () => monthlyPaymentBreakdown.reduce((max, m) => Math.max(max, m.total), 0) || 1,
    [monthlyPaymentBreakdown],
  );
  // "This month" must mean the real calendar month, not "the most recent
  // month that happens to have a payment" -- for a buyer with no payment
  // yet this month (e.g. all their September orders are still unpaid),
  // that fallback silently mislabeled last month's total as this month's.
  const monthOverMonth = useMemo(() => {
    if (monthlyPaymentBreakdown.length === 0) return null;
    const byKey = new Map(monthlyPaymentBreakdown.map(m => [m.key, m]));
    const currentKey = localMonthKey(Date.now());
    const [y, mo] = currentKey.split('-').map(Number);
    const previousKey = localMonthKey(new Date(y, mo - 2, 1).getTime());
    const currency = monthlyPaymentBreakdown[0].currency;
    const current = byKey.get(currentKey) ?? { key: currentKey, total: 0, count: 0, currency };
    const previous = byKey.get(previousKey) ?? null;
    const changePct = previous && previous.total > 0
      ? Math.round(((current.total - previous.total) / previous.total) * 100)
      : null;
    return { current, previous, changePct };
  }, [monthlyPaymentBreakdown]);

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

  // react-query's own isLoading is false while a query is disabled — i.e.
  // before `userId` resolves from auth — so without `!userId` this briefly
  // renders "No accounts yet" on every load, before flashing to the real list.
  const isLoading = accLoading || ledgerLoading || !userId;

  return (
    <div className="space-y-0 pb-16">
      {/* ── Top summary card ── */}
      {/* The Accounts tab is hidden; with Payments the only tab left there is nothing to switch between. */}

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
              {/* Banner — primary action plus a one-line pitch, with the
                  illustration pinned to the right edge in both languages. */}
              <div dir="ltr" className="relative min-h-[140px] overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-600 via-violet-600 to-blue-500 p-4 text-white shadow-lg shadow-indigo-500/20">
                <PaymentsBannerArt className="pointer-events-none absolute -bottom-1 right-2 h-[150px] w-auto" />
                <div className="relative z-10 flex min-h-[108px] max-w-[62%] flex-col items-start justify-between gap-5">
                  {statementLinks.length > 0 ? (
                    <button
                      onClick={() => setShowLogPayment(true)}
                      dir={lang === "ar" ? "rtl" : "ltr"}
                      className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-lg font-extrabold text-emerald-600 shadow-md transition-transform active:scale-95"
                    >
                      <Plus className="h-5 w-5" strokeWidth={3} />
                      {L("Log a Payment", "تسجيل دفعة")}
                    </button>
                  ) : <span className="h-12" />}
                  <p dir={lang === "ar" ? "rtl" : "ltr"} className="text-[13px] font-medium text-white/85">
                    {L("Track all your payments and statistics with ease", "تابع جميع دفعاتك وإحصائياتك بسهولة")}
                  </p>
                </div>
              </div>

              {/* Headline figures */}
              <div className="grid grid-cols-3 gap-2.5">
                {[
                  { label: L("Total Orders", "إجمالي الطلبات"), value: loanTotals.totalDebt, Icon: Database, tone: "bg-violet-500/15 text-violet-600" },
                  { label: L("Paid", "المدفوع"), value: loanTotals.totalPaid, Icon: ArrowLeftRight, tone: "bg-blue-500/15 text-blue-600" },
                  { label: L("Remaining", "المتبقي"), value: loanTotals.outstanding, Icon: HandCoins, tone: "bg-emerald-500/15 text-emerald-600" },
                ].map(c => (
                  <div key={c.label} className="flex min-w-0 items-center justify-between gap-1.5 rounded-2xl border border-border/50 bg-card p-3 shadow-sm">
                    <div className="min-w-0">
                      <p className="truncate text-[11px] font-semibold text-muted-foreground">{c.label}</p>
                      <p className="mt-0.5 truncate text-[15px] font-black tabular-nums">{fmtTotal(c.value)}</p>
                      <p className="text-[10px] text-muted-foreground">({loanTotals.currency})</p>
                    </div>
                    <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-full", c.tone)}>
                      <c.Icon className="h-5 w-5" />
                    </div>
                  </div>
                ))}
              </div>

              {/* Count + status breakdown. Listed cancelled-first for the
                  Arabic layout; the English layout gets the reverse so the
                  count card always sits on the left. */}
              <div className="grid grid-cols-4 gap-2">
                {(() => {
                  const pctOf = (n: number) => (overallCounts.total > 0 ? Math.round((n / overallCounts.total) * 100) : 0);
                  const cards = [
                    { key: "rejected", label: L("Not confirmed", "غير مؤكدة"), value: overallCounts.rejected, Icon: X, tone: "bg-rose-500/15 text-rose-500", bar: "from-rose-400 to-rose-300", pct: pctOf(overallCounts.rejected), text: "text-rose-500" },
                    { key: "pending", label: L("Processing", "قيد المعالجة"), value: overallCounts.pending, Icon: Clock, tone: "bg-amber-500/15 text-amber-500", bar: "from-amber-500 to-amber-300", pct: pctOf(overallCounts.pending), text: "text-amber-500" },
                    { key: "completed", label: L("Completed", "مكتمل"), value: overallCounts.completed, Icon: Check, tone: "bg-emerald-500/15 text-emerald-600", bar: "from-emerald-500 to-emerald-300", pct: pctOf(overallCounts.completed), text: "text-emerald-600" },
                    { key: "count", label: L("Payments", "عدد الدفعات"), value: overallCounts.total, Icon: Wallet2, tone: "bg-blue-500/15 text-blue-600", bar: "", pct: 0, text: "" },
                  ];
                  return (lang === "ar" ? cards : [...cards].reverse()).map(c => (
                    <div key={c.key} className="min-w-0 rounded-2xl border border-border/50 bg-card p-2.5 shadow-sm">
                      <div className="flex items-start justify-between gap-1">
                        <div className="min-w-0">
                          <p className="truncate text-[10px] font-semibold text-muted-foreground">{c.label}</p>
                          <p className="mt-0.5 text-lg font-black leading-tight tabular-nums">{c.value}</p>
                        </div>
                        <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full", c.tone)}>
                          <c.Icon className="h-4 w-4" strokeWidth={2.5} />
                        </div>
                      </div>
                      {c.bar && (
                        <div className="mt-1.5 flex items-center gap-1" dir="ltr">
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                            <div className={cn("h-full rounded-full bg-gradient-to-r", c.bar)} style={{ width: `${c.pct}%` }} />
                          </div>
                          <span className={cn("text-[10px] font-bold tabular-nums", c.text)}>{c.pct}%</span>
                        </div>
                      )}
                    </div>
                  ));
                })()}
              </div>

              {/* Settlement progress */}
              <div className="flex items-center gap-3 rounded-2xl border border-border/50 bg-card p-4 shadow-sm">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-muted-foreground">{L("Total Settled", "إجمالي المسدد")}</p>
                  <p className="mt-1 flex flex-wrap items-baseline gap-x-1.5 tabular-nums" dir="ltr">
                    <span className="text-2xl font-black">{fmtTotal(loanTotals.totalPaid)}</span>
                    <span className="text-sm font-medium text-muted-foreground">/ {fmtTotal(loanTotals.totalDebt)} ({loanTotals.currency})</span>
                  </p>
                  <div className="mt-2.5 h-2.5 overflow-hidden rounded-full bg-muted" dir="ltr">
                    <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all" style={{ width: `${loanTotals.settledPct}%` }} />
                  </div>
                </div>
                <div className="relative flex h-[76px] w-[76px] shrink-0 items-center justify-center">
                  <svg viewBox="0 0 80 80" className="h-[76px] w-[76px] -rotate-90">
                    <defs>
                      <linearGradient id="paymentRingGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stopColor="#10b981" />
                        <stop offset="100%" stopColor="#34d399" />
                      </linearGradient>
                    </defs>
                    <circle cx="40" cy="40" r="33" fill="none" stroke="currentColor" className="text-emerald-500/15" strokeWidth="8" />
                    <circle
                      cx="40" cy="40" r="33" fill="none" stroke="url(#paymentRingGradient)" strokeWidth="8" strokeLinecap="round"
                      strokeDasharray={2 * Math.PI * 33}
                      strokeDashoffset={2 * Math.PI * 33 * (1 - loanTotals.settledPct / 100)}
                      className="transition-all"
                    />
                  </svg>
                  <span className="absolute text-lg font-black tabular-nums">{loanTotals.settledPct}%</span>
                </div>
              </div>

              {/* Month pills + day/amount filter shortcut */}
              {paymentsMonths.length > 0 && (
                <div className="flex items-center gap-2">
                  <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {[{ key: null as string | null, label: L("All Months", "كل الأشهر") }, ...paymentsMonths.map(m => ({ key: m as string | null, label: monthPillLabel(m) }))].map(m => (
                      <button
                        key={m.key ?? "all"}
                        onClick={() => { userPickedPaymentsMonth.current = true; setPaymentsMonth(m.key); }}
                        className={cn(
                          "h-11 shrink-0 rounded-full px-5 text-sm font-bold whitespace-nowrap transition-colors",
                          paymentsMonth === m.key
                            ? "bg-blue-600 text-white shadow-md shadow-blue-500/30"
                            : "bg-blue-500/10 text-blue-700 hover:bg-blue-500/15 dark:text-blue-300",
                        )}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={() => setShowPaymentFilter(true)}
                    title={L("Filter by day or amount", "تصفية حسب اليوم أو المبلغ")}
                    className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-border/50 bg-card text-blue-600 shadow-sm"
                  >
                    <CalendarDays className="h-5 w-5" />
                  </button>
                </div>
              )}

              {/* Search, exports, filter */}
              <div className="flex items-center gap-1.5">
                <div className="relative min-w-0 flex-1">
                  <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    value={paymentSearch}
                    onChange={e => setPaymentSearch(e.target.value)}
                    placeholder={L("Search payments...", "بحث في الدفعات...")}
                    className="h-11 w-full rounded-xl border border-border/50 bg-card ps-9 pe-2 text-xs shadow-sm outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>
                <button
                  onClick={() => exportStatement(paymentsMonth, paymentsMonths, "xlsx")}
                  disabled={exportingFormat !== null}
                  title={L("Export XLSX", "تصدير XLSX")}
                  className="flex h-11 shrink-0 items-center gap-1 rounded-xl border border-border/50 bg-card px-2 text-[11px] font-extrabold text-emerald-600 shadow-sm disabled:opacity-60"
                >
                  {exportingFormat === "xlsx" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
                  XLSX
                </button>
                <button
                  onClick={() => exportStatement(paymentsMonth, paymentsMonths, "pdf")}
                  disabled={exportingFormat !== null}
                  title={L("Export PDF", "تصدير PDF")}
                  className="flex h-11 shrink-0 items-center gap-1 rounded-xl border border-border/50 bg-card px-2 text-[11px] font-extrabold text-blue-700 shadow-sm disabled:opacity-60 dark:text-blue-300"
                >
                  {exportingFormat === "pdf" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
                  PDF
                </button>
                <div className="relative shrink-0">
                  <button
                    onClick={() => setShowExportMenu(o => !o)}
                    className="flex h-11 items-center gap-1 rounded-xl border border-border/50 bg-card px-2 text-[11px] font-bold text-foreground shadow-sm"
                  >
                    {L("Export", "تصدير")}
                    <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", showExportMenu && "rotate-180")} />
                  </button>
                  {showExportMenu && (
                    <>
                      <div className="fixed inset-0 z-20" onClick={() => setShowExportMenu(false)} />
                      <div className="absolute end-0 top-12 z-30 w-36 overflow-hidden rounded-xl border border-border/60 bg-card shadow-lg">
                        <button
                          onClick={() => { setShowExportMenu(false); exportStatement(paymentsMonth, paymentsMonths, "pdf"); }}
                          className="flex w-full items-center gap-2 px-3 py-2.5 text-xs font-semibold hover:bg-muted"
                        >
                          <FileDown className="h-4 w-4 text-blue-600" /> {L("PDF statement", "كشف PDF")}
                        </button>
                        <button
                          onClick={() => { setShowExportMenu(false); exportStatement(paymentsMonth, paymentsMonths, "xlsx"); }}
                          className="flex w-full items-center gap-2 px-3 py-2.5 text-xs font-semibold hover:bg-muted"
                        >
                          <FileSpreadsheet className="h-4 w-4 text-emerald-600" /> {L("Excel statement", "كشف Excel")}
                        </button>
                      </div>
                    </>
                  )}
                </div>
                <button
                  onClick={() => {
                    if (!hasPaymentFilterCriteria) { setShowPaymentFilter(true); return; }
                    setPaymentFilterOn(on => !on);
                  }}
                  className={cn(
                    "flex h-11 shrink-0 items-center gap-1 rounded-xl border px-2 text-[11px] font-bold shadow-sm transition-colors",
                    activePaymentFilterCount > 0 ? "border-blue-500/50 bg-blue-500/10 text-blue-600" : "border-border/50 bg-card text-foreground",
                  )}
                >
                  <Filter className="h-4 w-4" />
                  {L("Filter", "تصفية")}
                  {activePaymentFilterCount > 0 && (
                    <span className="flex h-4 w-4 items-center justify-center rounded-full bg-blue-600 text-[9px] font-bold text-white">{activePaymentFilterCount}</span>
                  )}
                </button>
              </div>

              {/* Status chips */}
              <div className="flex items-center gap-2 rounded-2xl border border-border/50 bg-card p-2 shadow-sm">
                {([
                  { key: "all", label: L("All", "الكل"), Icon: ListIcon, count: statusCounts.all, idle: "bg-muted/60 text-foreground", dot: "text-blue-600" },
                  { key: "completed", label: L("Completed", "مكتمل"), Icon: Check, count: statusCounts.completed, idle: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300", dot: "bg-emerald-500 text-white" },
                  { key: "pending", label: L("Processing", "قيد المعالجة"), Icon: Clock, count: statusCounts.pending, idle: "bg-blue-500/10 text-blue-700 dark:text-blue-300", dot: "text-blue-600" },
                  { key: "rejected", label: L("Not confirmed", "غير مؤكدة"), Icon: X, count: statusCounts.rejected, idle: "bg-card text-foreground", dot: "bg-rose-500 text-white" },
                ] as const).map(s => {
                  const active = statusFilter === s.key;
                  return (
                    <button
                      key={s.key}
                      onClick={() => setStatusFilter(s.key)}
                      className={cn(
                        "flex h-11 min-w-0 items-center justify-center gap-1.5 rounded-2xl px-2.5 text-xs font-bold transition-colors",
                        s.key === "all" ? "shrink-0" : "flex-1",
                        active ? "bg-blue-600 text-white shadow-md shadow-blue-500/30" : s.idle,
                      )}
                    >
                      <span className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-full", active ? "text-white" : s.dot)}>
                        <s.Icon className="h-3.5 w-3.5" strokeWidth={3} />
                      </span>
                      <span className="truncate">{s.label}</span>
                      <span className={cn("rounded-lg px-1.5 text-xs font-black tabular-nums", active ? "bg-white/25" : "")}>{s.count}</span>
                    </button>
                  );
                })}
              </div>

              {/* Count + sort */}
              <div className="flex items-center justify-between gap-2 px-1">
                <p className="text-sm font-bold text-muted-foreground">
                  {visibleRows.length} {L("payments", "دفعة")}
                </p>
                <button
                  onClick={() => setPaymentSort(s => {
                    if (s === "date_desc") return "date_asc";
                    if (s === "date_asc") return "amount_desc";
                    if (s === "amount_desc") return "amount_asc";
                    return "date_desc";
                  })}
                  className="flex h-10 items-center gap-1.5 rounded-xl border border-border/50 bg-card px-3 text-xs font-bold shadow-sm"
                >
                  <ArrowUpDown className="h-4 w-4 text-blue-600" />
                  {paymentSort === "date_desc" && L("Newest first", "الأحدث أولاً")}
                  {paymentSort === "date_asc" && L("Oldest first", "الأقدم أولاً")}
                  {paymentSort === "amount_desc" && L("Highest first", "الأعلى أولاً")}
                  {paymentSort === "amount_asc" && L("Lowest first", "الأقل أولاً")}
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              </div>

              {/* Cards */}
              {visibleRows.length === 0 ? (
                <div className="rounded-2xl border border-border/50 bg-card px-6 py-10 text-center shadow-sm">
                  <p className="text-sm text-muted-foreground">
                    {loanPayments.length === 0 && unsettledPaymentClaims.length === 0
                      ? L("No payments recorded yet", "لا توجد دفعات مسجلة بعد")
                      : groupedLoanPayments.length === 0 && paymentRows.length === 0
                      ? L("No payments this month", "لا توجد دفعات هذا الشهر")
                      : L("No payments match your search", "لا توجد دفعات مطابقة لبحثك")}
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {visibleRows.map(r => {
                    const st = PAYMENT_STATUS_STYLES[r.status];
                    const StatusIcon = st.Icon;
                    const p = r.payment;
                    const seq = p ? paymentSequence.get(p.bucket) : undefined;
                    const myNote = p ? paymentNoteByKey.get(p.key) ?? "" : "";
                    const isEditingNote = !!p && editingNoteKey === p.key;
                    const correction = p ? resolveCorrection(p) : null;
                    const confirmingClaimDelete = !!r.claim && deleteClaimPromptId === r.claim.id;
                    const expanded = expandedPaymentKey === r.key;
                    const toggleDetails = () => { setMenuRowKey(null); setExpandedPaymentKey(k => (k === r.key ? null : r.key)); };
                    const sourceLabel = r.addedByCustomer ? L("Added by me", "أضفتها أنا") : L("Added by merchant", "أضافها التاجر");
                    const actionBtn = "flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground transition-colors";

                    return (
                      <div key={r.key} className="relative overflow-hidden rounded-2xl border border-border/50 bg-card shadow-sm">
                        <span className={cn("absolute inset-y-0 left-0 w-1.5", st.bar)} />
                        <div className="py-3 pl-5 pr-3">
                          <div className="flex items-center gap-2.5">
                            <button
                              onClick={toggleDetails}
                              aria-label={L("Details", "تفاصيل")}
                              className={cn("shrink-0 text-muted-foreground", lang !== "ar" && "order-last")}
                            >
                              <ChevronRight className={cn("h-5 w-5 transition-transform", expanded && "rotate-90")} />
                            </button>

                            <div className="shrink-0">
                              <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-bold", st.pill)}>
                                <StatusIcon className="h-3.5 w-3.5" />
                                {st.label(L)}
                              </span>
                            </div>

                            <div className="min-w-0 flex-1">
                              <p className={cn("whitespace-nowrap text-lg font-black leading-tight tabular-nums", st.amount)} dir="ltr">
                                {r.currency} {fmtTotal(r.amount)}
                              </p>
                              {r.note && <p className="truncate text-xs text-muted-foreground">{r.note}</p>}
                            </div>

                            <div className="shrink-0 space-y-1">
                              <span className={cn(
                                "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-bold",
                                r.addedByCustomer ? "bg-violet-500/15 text-violet-600" : "bg-blue-500/15 text-blue-600",
                              )}>
                                <span className="h-1.5 w-1.5 rounded-full bg-current" />
                                {sourceLabel}
                              </span>
                              <p className="flex items-center gap-1 whitespace-nowrap text-[11px] font-medium text-muted-foreground">
                                <CalendarDays className="h-3 w-3" /> {cardDateLabel(r.date)}
                              </p>
                              <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                                <Clock className="h-3 w-3" /> {cardTimeLabel(r.date)}
                              </p>
                            </div>

                            <div className="relative flex shrink-0 flex-col items-center gap-2">
                              {seq != null && (
                                <span className="rounded-lg border border-border/60 bg-muted/40 px-2 py-1 text-[11px] font-bold tabular-nums text-muted-foreground">
                                  #{seq}
                                </span>
                              )}
                              <button
                                onClick={() => setMenuRowKey(k => (k === r.key ? null : r.key))}
                                aria-label={L("More", "المزيد")}
                                className="rounded-full p-1 text-foreground hover:bg-muted"
                              >
                                <MoreHorizontal className="h-5 w-5" />
                              </button>
                              {menuRowKey === r.key && (
                                <>
                                  <div className="fixed inset-0 z-20" onClick={() => setMenuRowKey(null)} />
                                  <div className="absolute start-0 top-full z-30 mt-1 w-36 overflow-hidden rounded-xl border border-border/60 bg-card shadow-lg">
                                    <button onClick={toggleDetails} className="flex w-full items-center gap-2 px-3 py-2 text-xs font-semibold hover:bg-muted">
                                      <FileText className="h-3.5 w-3.5" /> {L("Details", "تفاصيل")}
                                    </button>
                                    {p && (
                                      <button
                                        onClick={() => { setMenuRowKey(null); setEditingNoteKey(p.key); setNoteDraft(myNote); }}
                                        className="flex w-full items-center gap-2 px-3 py-2 text-xs font-semibold hover:bg-muted"
                                      >
                                        <MessageSquare className="h-3.5 w-3.5" /> {myNote ? L("Edit note", "تعديل الملاحظة") : L("Add note", "إضافة ملاحظة")}
                                      </button>
                                    )}
                                    {correction && !correction.changeRequest && (
                                      <>
                                        <button onClick={() => { setMenuRowKey(null); correction.onEdit(); }} className="flex w-full items-center gap-2 px-3 py-2 text-xs font-semibold hover:bg-muted">
                                          <Edit2 className="h-3.5 w-3.5" /> {L("Edit", "تعديل")}
                                        </button>
                                        <button onClick={() => { setMenuRowKey(null); setDeletePaymentPromptKey(r.key); }} className="flex w-full items-center gap-2 px-3 py-2 text-xs font-semibold text-rose-600 hover:bg-muted">
                                          <Trash2 className="h-3.5 w-3.5" /> {L("Delete", "حذف")}
                                        </button>
                                      </>
                                    )}
                                    {r.claim && r.status === "pending" && !confirmingClaimDelete && (
                                      <>
                                        <button onClick={() => { setMenuRowKey(null); setEditingClaimId(r.claim!.id); }} className="flex w-full items-center gap-2 px-3 py-2 text-xs font-semibold hover:bg-muted">
                                          <Edit2 className="h-3.5 w-3.5" /> {L("Edit", "تعديل")}
                                        </button>
                                        <button onClick={() => { setMenuRowKey(null); setDeleteClaimPromptId(r.claim!.id); }} className="flex w-full items-center gap-2 px-3 py-2 text-xs font-semibold text-rose-600 hover:bg-muted">
                                          <Trash2 className="h-3.5 w-3.5" /> {L("Delete", "حذف")}
                                        </button>
                                      </>
                                    )}
                                  </div>
                                </>
                              )}
                            </div>
                          </div>

                          {/* Note editor */}
                          {isEditingNote && p && (
                            <div className="mt-2 flex items-center gap-1.5">
                              <input
                                autoFocus
                                value={noteDraft}
                                onChange={e => setNoteDraft(e.target.value)}
                                placeholder={L("Add a note...", "أضف ملاحظة...")}
                                onKeyDown={e => {
                                  if (e.key === "Enter") { savePaymentNote.mutate({ key: p.key, note: noteDraft.trim() }); setEditingNoteKey(null); }
                                  if (e.key === "Escape") setEditingNoteKey(null);
                                }}
                                className="h-9 flex-1 rounded-lg border border-border/50 bg-background px-2.5 text-xs outline-none focus:ring-2 focus:ring-primary/30"
                              />
                              <button
                                onClick={() => { savePaymentNote.mutate({ key: p.key, note: noteDraft.trim() }); setEditingNoteKey(null); }}
                                className="rounded-lg bg-primary p-2 text-primary-foreground"
                              >
                                <Check className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          )}

                          {/* Actions — edit/delete only appear when the row can be
                              tied to a correction (own claim, or a single
                              unambiguous merchant-entered payment); either way
                              it is a request the merchant applies, since the
                              repayment itself sits in their books. */}
                          <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1.5">
                            {p && !isEditingNote && (
                              myNote ? (
                                <button onClick={() => { setEditingNoteKey(p.key); setNoteDraft(myNote); }} className={cn(actionBtn, "min-w-0 max-w-[40%] text-primary")}>
                                  <MessageSquare className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">{myNote}</span>
                                </button>
                              ) : (
                                <button onClick={() => { setEditingNoteKey(p.key); setNoteDraft(""); }} className={cn(actionBtn, "hover:text-primary")}>
                                  <MessageSquare className="h-3.5 w-3.5" /> {L("Add note", "إضافة ملاحظة")}
                                </button>
                              )
                            )}

                            {correction && (
                              correction.changeRequest ? (
                                <>
                                  <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-600">
                                    {correction.changeRequest === "delete" ? L("Removal requested", "طُلب الحذف") : L("Change requested", "طُلب التعديل")}
                                  </span>
                                  <button onClick={correction.onCancelRequest} className={cn(actionBtn, "hover:text-foreground")}>
                                    {L("Cancel request", "إلغاء الطلب")}
                                  </button>
                                </>
                              ) : deletePaymentPromptKey === r.key ? (
                                <>
                                  <span className="text-[11px] text-rose-600">{L("Ask the merchant to remove this payment?", "طلب حذف هذه الدفعة من التاجر؟")}</span>
                                  <button
                                    onClick={() => { correction.onRequestDelete(); setDeletePaymentPromptKey(null); }}
                                    className="rounded-lg bg-rose-600 px-2.5 py-1 text-[11px] font-bold text-white"
                                  >
                                    {L("Request", "إرسال")}
                                  </button>
                                  <button onClick={() => setDeletePaymentPromptKey(null)} className="rounded-lg border border-border/50 px-2.5 py-1 text-[11px] font-semibold hover:bg-muted">
                                    {L("Cancel", "إلغاء")}
                                  </button>
                                </>
                              ) : (
                                <>
                                  <button onClick={correction.onEdit} className={cn(actionBtn, "hover:text-primary")}>
                                    <Pencil className="h-3.5 w-3.5" /> {L("Edit", "تعديل")}
                                  </button>
                                  <button onClick={() => setDeletePaymentPromptKey(r.key)} className={cn(actionBtn, "hover:text-rose-600")}>
                                    <Trash2 className="h-3.5 w-3.5" /> {L("Delete", "حذف")}
                                  </button>
                                </>
                              )
                            )}

                            {r.claim && r.status === "pending" && (
                              confirmingClaimDelete ? (
                                <>
                                  <span className="text-[11px] text-rose-600">{L("Delete this reported payment?", "حذف هذه الدفعة المُبلغ عنها؟")}</span>
                                  <button
                                    onClick={() => { deleteClaim.mutate(r.claim!.id); setDeleteClaimPromptId(null); }}
                                    className="rounded-lg bg-rose-600 px-2.5 py-1 text-[11px] font-bold text-white"
                                  >
                                    {L("Delete", "حذف")}
                                  </button>
                                  <button onClick={() => setDeleteClaimPromptId(null)} className="rounded-lg border border-border/50 px-2.5 py-1 text-[11px] font-semibold hover:bg-muted">
                                    {L("Cancel", "إلغاء")}
                                  </button>
                                </>
                              ) : (
                                <>
                                  <button onClick={() => setEditingClaimId(r.claim!.id)} className={cn(actionBtn, "hover:text-primary")}>
                                    <Pencil className="h-3.5 w-3.5" /> {L("Edit", "تعديل")}
                                  </button>
                                  <button onClick={() => setDeleteClaimPromptId(r.claim!.id)} className={cn(actionBtn, "hover:text-rose-600")}>
                                    <Trash2 className="h-3.5 w-3.5" /> {L("Delete", "حذف")}
                                  </button>
                                </>
                              )
                            )}

                            <button onClick={toggleDetails} className={cn(actionBtn, "hover:text-primary")}>
                              <ListIcon className="h-3.5 w-3.5" /> {L("View details", "عرض التفاصيل")}
                            </button>
                          </div>

                          {expanded && (
                            <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
                              <div className="flex justify-between gap-2">
                                <span>{L("Time", "الوقت")}</span>
                                <span className="font-semibold text-foreground">{cardTimeLabel(r.date)}</span>
                              </div>
                              <div className="flex justify-between gap-2">
                                <span>{L("Currency", "العملة")}</span>
                                <span className="font-semibold text-foreground">{r.currency}</span>
                              </div>
                              <div className="flex justify-between gap-2">
                                <span>{L("Source", "المصدر")}</span>
                                <span className="font-semibold text-foreground">{sourceLabel}</span>
                              </div>
                              <div className="flex justify-between gap-2">
                                <span>{L("Status", "الحالة")}</span>
                                <span className="font-semibold text-foreground">{st.label(L)}</span>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
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
      {showPaymentFilter && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowPaymentFilter(false)}>
          <div className="w-full max-w-md rounded-t-2xl bg-background p-5 pb-8 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <p className="font-bold text-sm">🔎 {L("Filter Payments", "تصفية الدفعات")}</p>
              <button onClick={() => setShowPaymentFilter(false)} className="rounded-full p-1.5 hover:bg-muted"><X className="h-4 w-4" /></button>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">{L("Day", "اليوم")}</label>
              {/* One-tap presets for the common case — picks the day and
                  closes the sheet immediately, since the list is already
                  filtering live. The date input below stays for anything
                  further back. */}
              <div className="flex gap-1.5">
                {([
                  { label: L("Today", "اليوم"), days: 0 },
                  { label: L("Yesterday", "أمس"), days: 1 },
                ] as const).map(preset => {
                  const key = localDayKey(Date.now() - preset.days * 86400000);
                  return (
                    <button
                      key={preset.label}
                      onClick={() => { setPaymentFilterDay(key); setPaymentFilterOn(true); setShowPaymentFilter(false); }}
                      className={cn(
                        "flex-1 h-9 rounded-xl border text-xs font-semibold transition-colors",
                        paymentFilterDay === key ? "border-primary/40 bg-primary/10 text-primary" : "border-border/50 bg-card hover:border-primary/40",
                      )}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>
              <QuickDateField
                value={paymentFilterDay}
                lang={lang === "ar" ? "ar" : "en"}
                quickDays={[]}
                onChange={day => {
                  setPaymentFilterDay(day);
                  if (day) { setPaymentFilterOn(true); setShowPaymentFilter(false); }
                }}
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">{L("Amount range", "نطاق المبلغ")}</label>
              <div className="grid grid-cols-2 gap-2">
                <input
                  inputMode="decimal"
                  value={paymentFilterMinAmount}
                  onChange={e => setPaymentFilterMinAmount(e.target.value)}
                  placeholder={L("Min", "الأدنى")}
                  className="h-11 w-full rounded-xl border border-border/50 bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                />
                <input
                  inputMode="decimal"
                  value={paymentFilterMaxAmount}
                  onChange={e => setPaymentFilterMaxAmount(e.target.value)}
                  placeholder={L("Max", "الأعلى")}
                  className="h-11 w-full rounded-xl border border-border/50 bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => { setPaymentFilterDay(""); setPaymentFilterMinAmount(""); setPaymentFilterMaxAmount(""); setPaymentFilterOn(false); }}
                className="flex-1 h-11 rounded-xl border border-border/50 text-sm font-semibold hover:bg-muted"
              >
                {L("Clear", "مسح")}
              </button>
              <button
                onClick={() => { setPaymentFilterOn(true); setShowPaymentFilter(false); }}
                className="flex-1 h-11 rounded-xl bg-primary text-sm font-bold text-primary-foreground"
              >
                {L("Apply", "تطبيق")}
              </button>
            </div>
          </div>
        </div>
      )}
      {showLogPayment && (
        <LogPaymentModal lang={lang} links={statementLinks} saving={submitClaim.isPending}
          onClose={() => setShowLogPayment(false)}
          onSave={input => {
            submitClaim.mutate(input, { onSuccess: () => setShowLogPayment(false) });
          }} />
      )}
      {editingClaim && (
        <LogPaymentModal lang={lang} links={statementLinks}
          saving={editingClaim.status === "accepted" ? requestChange.isPending : updateClaim.isPending}
          existing={{ id: editingClaim.id, currency: editingClaim.currency, amount: editingClaim.amount, note: editingClaim.note, paidAt: editingClaim.paidAt }}
          needsApproval={editingClaim.status === "accepted"}
          onClose={() => setEditingClaimId(null)}
          onSave={input => {
            // A claim the merchant already accepted has become a repayment
            // in their tracker -- correcting it is a request they apply,
            // not a write this side can make.
            if (editingClaim.status === "accepted") {
              requestChange.mutate(
                { id: editingClaim.id, kind: "edit", amount: input.amount, note: input.note, paidAt: input.paidAt },
                { onSuccess: () => setEditingClaimId(null) },
              );
              return;
            }
            updateClaim.mutate({ id: editingClaim.id, amount: input.amount, note: input.note, paidAt: input.paidAt }, { onSuccess: () => setEditingClaimId(null) });
          }} />
      )}
      {editingMerchantPayment && (
        <LogPaymentModal
          lang={lang}
          links={statementLinks}
          saving={requestMerchantPaymentChange.isPending}
          existing={{
            id: editingMerchantPayment.bucket, currency: editingMerchantPayment.currency,
            amount: editingMerchantPayment.amount, note: editingMerchantPayment.note,
            paidAt: new Date(editingMerchantPayment.date).toISOString(),
          }}
          needsApproval
          onClose={() => setEditingMerchantPayment(null)}
          onSave={input => {
            const link = statementLinks.find(l => l.currency === editingMerchantPayment.currency);
            if (!link) return;
            requestMerchantPaymentChange.mutate(
              {
                merchantUserId: link.merchantUserId, customerId: link.customerId, currency: editingMerchantPayment.currency,
                amount: editingMerchantPayment.amount, paidAt: editingMerchantPayment.date,
                kind: "edit", changeAmount: input.amount, changeNote: input.note, changePaidAt: input.paidAt,
              },
              { onSuccess: () => setEditingMerchantPayment(null) },
            );
          }} />
      )}
    </div>
  );
}
