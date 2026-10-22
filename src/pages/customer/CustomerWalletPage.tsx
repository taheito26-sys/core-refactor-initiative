import { statementQueryOptions } from "@/features/customer/statements-api";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, X, Loader2, Trash2, Edit2, ArrowLeftRight, BookOpen, HandCoins, ChevronDown, ChevronLeft, Pencil, Check, Minus, CalendarDays, Wallet2, Trophy, Search, ArrowUpDown, FileDown, FileSpreadsheet, Filter, CreditCard, Coins, List as ListIcon, FileText, Clock, CheckCircle2, XCircle, ChevronRight, MoreHorizontal, MessageSquare, Database, User, Bell, Info, FilePlus, Users, UserPlus, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/features/auth/auth-context";
import { useTheme } from "@/lib/theme-context";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { formatCustomerNumber, resolveCustomerDisplayName } from "@/features/customer/customer-portal";
import { useNavigate } from "react-router-dom";
import { useIsMobile } from "@/hooks/use-mobile";
import { giverPaymentNumbers, normalizeGiverText, resolveGiver, typedPaymentNumber, uniquePaymentKeys } from "@/features/customer/cash-givers";
import { useNotifications } from "@/hooks/useNotifications";
import { ZoomControls } from "@/components/shared/ZoomControls";
import { DateRangeFilterDropdown } from "@/features/orders/components/DateRangeFilterDropdown";
import "@/styles/customer-home.css";
import "@/styles/customer-orders.css";
import "@/styles/customer-theme.css";
import "@/styles/customer-wallet.css";
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

function LogPaymentModal({ links, existing, needsApproval, onSave, onClose, lang, saving, givers, onAddGiver }: {
  links: StatementLinkOption[];
  /** Present when correcting an already-submitted claim instead of logging a new one. */
  existing?: { id: string; currency: string; amount: number; note: string | null; paidAt: string; giver?: string | null };
  /** The buyer's list of people who hand over cash. */
  givers: string[];
  onAddGiver: (name: string) => Promise<void>;
  /** The claim was already accepted, so this edit is a request the merchant has to apply. */
  needsApproval?: boolean;
  onSave: (input: { merchantUserId: string; customerId: string; currency: string; amount: number; note?: string; paidAt: number; giver?: string }) => void;
  onClose: () => void; lang: string; saving: boolean;
}) {
  const L = (en: string, ar: string) => lang === "ar" ? ar : en;
  const [linkIndex, setLinkIndex] = useState(0);
  const [amount, setAmount] = useState(existing ? String(existing.amount) : "");
  const [giver, setGiver] = useState(existing?.giver ?? "");
  const [addingGiver, setAddingGiver] = useState(givers.length === 0);
  const [newGiver, setNewGiver] = useState("");
  const [savingGiver, setSavingGiver] = useState(false);
  const [dateStr, setDateStr] = useState(dateInputValue(existing ? new Date(existing.paidAt).getTime() : Date.now()));
  const [err, setErr] = useState("");
  const link = links[linkIndex];
  const amtNum = parseFloat(amount) || 0;

  const handle = () => {
    if (!existing && !link) { setErr(L("No linked loan found", "لا يوجد قرض مرتبط")); return; }
    if (!(amtNum > 0)) { setErr(L("Enter a valid amount", "أدخل مبلغاً صحيحاً")); return; }
    if (!existing && !giver) { setErr(L("Choose who gave the cash", "اختر من سلّم المبلغ")); return; }
    const paidAt = new Date(`${dateStr}T00:00:00`).getTime();
    if (!Number.isFinite(paidAt)) { setErr(L("Enter a valid date", "أدخل تاريخاً صحيحاً")); return; }
    onSave({
      merchantUserId: link?.merchantUserId ?? "",
      customerId: link?.customerId ?? "",
      currency: existing?.currency ?? link!.currency,
      amount: amtNum,
      // The giver's name is the note: the merchant sees who handed over the cash, and the
      // statement recognises the giver again once the payment is accepted. A correction that
      // keeps the same giver leaves the existing note untouched.
      note: giver ? (existing?.note && giver === (existing.giver ?? "") ? existing.note : giver) : (existing?.note || undefined),
      giver: giver || undefined,
      paidAt,
    });
  };

  const addGiver = async () => {
    const name = newGiver.trim();
    if (!name) return;
    setSavingGiver(true);
    try {
      await onAddGiver(name);
      setGiver(givers.find(g => normalizeGiverText(g) === normalizeGiverText(name)) ?? name);
      setNewGiver("");
      setAddingGiver(false);
      setErr("");
    } catch {
      // the failure is already toasted by the mutation
    } finally {
      setSavingGiver(false);
    }
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
          <label className="text-xs font-medium text-muted-foreground">{L("Cash giver", "من سلّم المبلغ")}{existing ? ` ${L("(optional)", "(اختياري)")}` : ""}</label>
          <ModernSelect value={giver} placeholder={L("Select who gave the cash", "اختر من سلّم المبلغ")}
            onChange={e => {
              if (e.target.value === "__new__") { setAddingGiver(true); return; }
              setGiver(e.target.value);
            }}
            className="h-11 w-full rounded-xl border border-border/50 bg-card px-3 text-sm outline-none">
            {existing && <option value="">{L("— None —", "— بدون —")}</option>}
            {givers.map(g => <option key={g} value={g}>{g}</option>)}
            <option value="__new__">＋ {L("Add new giver", "إضافة شخص جديد")}</option>
          </ModernSelect>
          {addingGiver && (
            <div className="flex items-center gap-2 pt-1">
              <input autoFocus value={newGiver} onChange={e => setNewGiver(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void addGiver(); } }}
                placeholder={L("Name, e.g. Hassan", "الاسم، مثل: حسن")}
                className="h-10 min-w-0 flex-1 rounded-xl border border-border/50 bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-primary/30" />
              <button type="button" onClick={() => void addGiver()} disabled={savingGiver || !newGiver.trim()}
                className="flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-primary px-3 text-xs font-bold text-primary-foreground disabled:opacity-50">
                {savingGiver ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                {L("Add", "إضافة")}
              </button>
            </div>
          )}
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

// Tags one payment with a giver, and keeps the buyer's list (add / remove).
function GiverPickerModal({ givers, current, onPick, onAdd, onDelete, onClose, lang }: {
  givers: string[]; current: string | null;
  onPick: (name: string | null) => void;
  onAdd: (name: string) => Promise<void>;
  onDelete: (name: string) => void;
  onClose: () => void; lang: string;
}) {
  const L = (en: string, ar: string) => lang === "ar" ? ar : en;
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const add = async () => {
    const n = name.trim();
    if (!n) return;
    setBusy(true);
    try { await onAdd(n); onPick(n); } catch { /* toasted by the mutation */ } finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md space-y-3 rounded-t-2xl bg-background p-5 pb-8" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <p className="flex items-center gap-2 text-sm font-bold"><Users className="h-4 w-4" />{L("Cash giver", "من سلّم المبلغ")}</p>
          <button onClick={onClose} className="rounded-full p-1.5 hover:bg-muted"><X className="h-4 w-4" /></button>
        </div>
        <div className="max-h-[40vh] space-y-1.5 overflow-y-auto">
          {givers.map(g => (
            <div key={g} className="flex items-center gap-2">
              <button onClick={() => onPick(g)}
                className={cn("flex h-11 min-w-0 flex-1 items-center justify-between rounded-xl border px-3 text-sm font-semibold",
                  current && normalizeGiverText(current) === normalizeGiverText(g) ? "border-primary bg-primary/10 text-primary" : "border-border/50 bg-card")}>
                <span className="truncate">{g}</span>
                {current && normalizeGiverText(current) === normalizeGiverText(g) && <Check className="h-4 w-4 shrink-0" />}
              </button>
              <button onClick={() => { if (window.confirm(L(`Remove ${g} from your list?`, `حذف ${g} من القائمة؟`))) onDelete(g); }}
                aria-label={L("Remove", "حذف")} className="rounded-full p-2 text-muted-foreground hover:bg-rose-500/10 hover:text-rose-600">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          {givers.length === 0 && <p className="py-2 text-center text-xs text-muted-foreground">{L("No givers yet — add the first one below.", "لا يوجد أشخاص بعد — أضف الأول أدناه.")}</p>}
        </div>
        <div className="flex items-center gap-2">
          <input value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void add(); } }}
            placeholder={L("New giver's name", "اسم شخص جديد")}
            className="h-10 min-w-0 flex-1 rounded-xl border border-border/50 bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-primary/30" />
          <button onClick={() => void add()} disabled={busy || !name.trim()}
            className="flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-primary px-3 text-xs font-bold text-primary-foreground disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}{L("Add", "إضافة")}
          </button>
        </div>
        {current && (
          <button onClick={() => onPick(null)} className="h-10 w-full rounded-xl border border-border/50 text-xs font-semibold text-muted-foreground hover:bg-muted">
            {L("Clear giver for this payment", "إزالة الشخص من هذه الدفعة")}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────

// Giver-filter value for "payments with no giver" (never a real name).
const NO_GIVER = "__none__";

// ── Payments card styling ─────────────────────────────────────────

// Card accents alternate within a status for completed rows (green/purple). A payment still waiting
// on the merchant is always red, and a rejected one grey, so red only ever means "not confirmed yet".
const PAYMENT_STATUS_STYLES = {
  completed: { accents: ["#16a34a", "#7c3aed"], Icon: Check, label: (L: (en: string, ar: string) => string) => L("Completed", "مكتمل") },
  pending: { accents: ["#e11d48"], Icon: Clock, label: (L: (en: string, ar: string) => string) => L("Processing", "قيد المعالجة") },
  rejected: { accents: ["#64748b"], Icon: X, label: (L: (en: string, ar: string) => string) => L("Cancelled", "ملغي") },
} as const;

function MoneyBagIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 3h6l-1.6 3.2h-2.8L9 3Z" />
      <path d="M10.4 6.2C6.6 8 4.5 11.4 4.5 15c0 3.6 2.8 6 7.5 6s7.5-2.4 7.5-6c0-3.6-2.1-7-5.9-8.8" />
      <path d="M14 11.4c-.4-.7-1.2-1.1-2.1-1.1-1.2 0-2.1.6-2.1 1.5 0 2.1 4.4 1 4.4 3.2 0 .9-1 1.6-2.3 1.6-1 0-1.9-.4-2.3-1.1M12 9.3v1M12 16.6v1" />
    </svg>
  );
}

export default function CustomerWalletPage() {
  const { userId, customerProfile } = useAuth();
  const { settings, update } = useTheme();
  const isPhone = useIsMobile();
  const navigate = useNavigate();
  const { unreadCount } = useNotifications();
  const qc = useQueryClient();
  const lang = settings.language;
  const L = (en: string, ar: string) => lang === "ar" ? ar : en;
  const fmt = (v: number, d = 0) => formatCustomerNumber(v, lang, d);
  const displayName = resolveCustomerDisplayName(customerProfile, lang === "ar" ? "ar" : "en") ?? "—";

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
    const rows: { date: number; amount: number; currency: string; note: string | null; ref: string | null; addedByCustomer: boolean }[] = [];
    for (const s of loanStatements) {
      for (const p of s.payments) {
        rows.push({ date: p.date, amount: p.amount, currency: s.currency, note: stripSystemNotePrefix(p.note), ref: p.ref, addedByCustomer: isCustomerReportedNote(p.note) });
      }
    }
    return uniquePaymentKeys(rows).sort((a, b) => b.date - a.date);
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

  /* The two giver tables are newer than the generated Supabase types, so they are addressed untyped. */
  /* eslint-disable @typescript-eslint/no-explicit-any */
  // The buyer's cash givers and the payments tagged with one. The tables are the
  // buyer's own annotations (see the migration), so a failed read just means no givers.
  const { data: giverRows = [] } = useQuery({
    queryKey: ["customer-cash-givers", userId],
    queryFn: async () => {
      if (!userId) return [] as { name: string }[];
      const { data, error } = await supabase.from("customer_cash_givers" as any).select("name").eq("user_id", userId).order("created_at", { ascending: true });
      if (error) { console.warn("[CustomerWalletPage] cash givers query error:", error.message); return [] as { name: string }[]; }
      return (data ?? []) as unknown as { name: string }[];
    },
    enabled: !!userId,
  });
  const giverNames = useMemo(() => giverRows.map(g => g.name), [giverRows]);
  const { data: giverAssignments = [] } = useQuery({
    queryKey: ["customer-payment-givers", userId],
    queryFn: async () => {
      if (!userId) return [] as { payment_key: string; giver_name: string }[];
      const { data, error } = await supabase.from("customer_payment_givers" as any).select("payment_key, giver_name").eq("user_id", userId);
      if (error) { console.warn("[CustomerWalletPage] payment givers query error:", error.message); return [] as { payment_key: string; giver_name: string }[]; }
      return (data ?? []) as unknown as { payment_key: string; giver_name: string }[];
    },
    enabled: !!userId,
  });
  const assignedGiverByKey = useMemo(() => new Map(giverAssignments.map(a => [a.payment_key, a.giver_name])), [giverAssignments]);

  const addGiver = useMutation({
    mutationFn: async (name: string) => {
      const { error } = await supabase.from("customer_cash_givers" as any).insert({ user_id: userId, name });
      // 23505: the name is already on the list, which is what the buyer wanted anyway.
      if (error && (error as { code?: string }).code !== "23505") throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["customer-cash-givers", userId] }); },
    onError: (e: any) => toast.error(e?.message),
  });
  const deleteGiver = useMutation({
    mutationFn: async (name: string) => {
      const { error } = await supabase.from("customer_cash_givers" as any).delete().eq("user_id", userId).eq("name", name);
      if (error) throw error;
      await supabase.from("customer_payment_givers" as any).delete().eq("user_id", userId).eq("giver_name", name);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["customer-cash-givers", userId] });
      qc.invalidateQueries({ queryKey: ["customer-payment-givers", userId] });
    },
    onError: (e: any) => toast.error(e?.message),
  });
  const assignGiver = useMutation({
    mutationFn: async ({ key, giver }: { key: string; giver: string | null }) => {
      if (giver) {
        const { error } = await supabase.from("customer_payment_givers" as any).upsert(
          { user_id: userId, payment_key: key, giver_name: giver },
          { onConflict: "user_id,payment_key" },
        );
        if (error) throw error;
      } else {
        const { error } = await supabase.from("customer_payment_givers" as any).delete().eq("user_id", userId).eq("payment_key", key);
        if (error) throw error;
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["customer-payment-givers", userId] }); },
    onError: (e: any) => toast.error(e?.message),
  });
  /* eslint-enable @typescript-eslint/no-explicit-any */
  const [giverPicker, setGiverPicker] = useState<{ key: string; current: string | null } | null>(null);
  const claimPaymentKey = (c: { currency: string; paidAt: string; amount: number }) => `${c.currency}:${new Date(c.paidAt).getTime()}:${c.amount}`;

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
      base: p.base,
      bucket: p.base,
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
  // never depends on which month filter is active. A payment still waiting
  // on the merchant is numbered in the same date order, so the list never
  // shows a gap and the number stays the same once the merchant accepts it.
  const paymentSequence = useMemo(() => {
    const sorted = [
      ...loanPayments.map(p => ({ key: p.key, date: p.date })),
      ...unsettledPaymentClaims.filter(c => c.status === "pending").map(c => ({ key: `claim:${c.id}`, date: new Date(c.paidAt).getTime() })),
    ].sort((a, b) => a.date - b.date || a.key.localeCompare(b.key));
    const map = new Map<string, number>();
    const countByMonth = new Map<string, number>();
    for (const p of sorted) {
      const monthKey = localMonthKey(p.date);
      const next = (countByMonth.get(monthKey) ?? 0) + 1;
      countByMonth.set(monthKey, next);
      map.set(p.key, next);
    }
    return map;
  }, [loanPayments, unsettledPaymentClaims]);

  // Search + sort controls for the Payments Received list — lets the buyer
  // find a specific payment by its note instead of scrolling the whole
  // month, and re-order it (newest/oldest/largest/smallest) rather than
  // being stuck with insertion order.
  const [paymentSearch, setPaymentSearch] = useState("");
  const [paymentSort, setPaymentSort] = useState<"date_desc" | "date_asc">("date_desc");

  // Day + amount-range filter — separate from the month pills above (those
  // narrow to a whole month; this narrows further, to one specific day
  // and/or an amount bracket, for a buyer trying to find one payment they
  // half-remember the size or date of).
  const [showPaymentFilter, setShowPaymentFilter] = useState(false);
  // The period's first day; with paymentFilterTo empty the period is just this one day.
  const [paymentFilterDay, setPaymentFilterDay] = useState("");
  const [paymentFilterTo, setPaymentFilterTo] = useState("");
  const [paymentFilterMinAmount, setPaymentFilterMinAmount] = useState("");
  const [paymentFilterMaxAmount, setPaymentFilterMaxAmount] = useState("");
  // Whether the remembered day/amount criteria above are currently being
  // applied. Kept separate from the criteria themselves so a single tap on
  // the Filter chip can flip filtering on/off without losing what was
  // configured — the buyer re-enables the same filter with one tap instead
  // of re-entering it.
  const [paymentFilterOn, setPaymentFilterOn] = useState(false);
  // Who handed over the cash: "" for everyone, NO_GIVER for payments with no giver, else a giver's name.
  const [paymentGiverFilter, setPaymentGiverFilter] = useState("");
  const paymentPeriodEnd = paymentFilterTo || paymentFilterDay;
  const inPaymentPeriod = (dayKey: string) => dayKey >= paymentFilterDay && dayKey <= paymentPeriodEnd;
  // The date picker in the toolbar, for a day or a period. It also moves the month chips: to the
  // month the period sits in, or to all months when it crosses a month boundary, so what was
  // picked never lands outside the selected month and shows an empty list.
  const setPaymentPeriod = (from: string, to: string) => {
    setPaymentFilterDay(from);
    setPaymentFilterTo(to);
    setPaymentFilterOn(!!from || !!paymentFilterMinAmount || !!paymentFilterMaxAmount);
    if (from) {
      userPickedPaymentsMonth.current = true;
      setPaymentsMonth(to && to.slice(0, 7) !== from.slice(0, 7) ? null : from.slice(0, 7));
    }
  };
  const hasPaymentFilterCriteria = !!(paymentFilterDay || paymentFilterMinAmount || paymentFilterMaxAmount);
  const activePaymentFilterCount = paymentFilterOn && hasPaymentFilterCriteria ? 1 : 0;

  const displayedLoanPayments = useMemo(() => {
    const minAmount = paymentFilterMinAmount.trim() ? parseFloat(paymentFilterMinAmount) : null;
    const maxAmount = paymentFilterMaxAmount.trim() ? parseFloat(paymentFilterMaxAmount) : null;
    const filtered = groupedLoanPayments.filter(p => {
      if (paymentFilterOn) {
        if (paymentFilterDay && !inPaymentPeriod(localDayKey(p.date))) return false;
        if (minAmount != null && Number.isFinite(minAmount) && p.amount < minAmount) return false;
        if (maxAmount != null && Number.isFinite(maxAmount) && p.amount > maxAmount) return false;
      }
      return true;
    });
    const sorted = [...filtered];
    sorted.sort((a, b) => {
      switch (paymentSort) {
        case "date_asc": return a.date - b.date || a.key.localeCompare(b.key);
        default: return b.date - a.date || b.key.localeCompare(a.key);
      }
    });
    return sorted;
  }, [groupedLoanPayments, paymentSort, paymentFilterOn, paymentFilterDay, paymentFilterTo, paymentFilterMinAmount, paymentFilterMaxAmount]);
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
  const cardDateLabel = (ts: number) => new Date(ts).toLocaleDateString(numLocale, { day: "numeric", month: lang === "ar" ? "long" : "short", year: "numeric" });
  const cardTimeLabel = (ts: number) => new Date(ts).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
  const monthPillLabel = (key: string) => {
    const [y, mo] = key.split("-");
    return `${new Date(parseInt(y), parseInt(mo) - 1).toLocaleDateString(numLocale, { month: lang === "ar" ? "long" : "short" })} ${y.slice(2)}`;
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
    /** Who handed over the cash, and which of their payments this is (1 = their first). */
    giver: string | null;
    giverNo: number | null;
    /** Key the giver assignment is stored under. */
    assignKey: string;
  };

  // Giver per payment, and each giver's running payment number across everything the buyer
  // has paid (not just the month on screen). A reported payment still waiting on the merchant
  // counts, so a payment just logged is already number 1; a rejected one gets no number.
  const giverInfo = useMemo(() => {
    const giverByRow = new Map<string, string | null>();
    const entries: { key: string; date: number; giver: string | null; typed: number | null }[] = [];
    for (const p of loanPayments) {
      const giver = resolveGiver(assignedGiverByKey.get(p.key) ?? assignedGiverByKey.get(p.base), [p.note, paymentNoteByKey.get(p.key) ?? paymentNoteByKey.get(p.base)], giverNames);
      giverByRow.set(p.key, giver);
      entries.push({ key: p.key, date: p.date, giver, typed: typedPaymentNumber([p.note, paymentNoteByKey.get(p.key) ?? paymentNoteByKey.get(p.base)], giver) });
    }
    for (const c of unsettledPaymentClaims) {
      const key = `claim:${c.id}`;
      const giver = resolveGiver(assignedGiverByKey.get(claimPaymentKey(c)), [c.note], giverNames);
      giverByRow.set(key, giver);
      if (c.status === "pending") entries.push({ key, date: new Date(c.paidAt).getTime(), giver, typed: typedPaymentNumber([c.note], giver) });
    }
    return { giverByRow, numbers: giverPaymentNumbers(entries) };
  }, [loanPayments, unsettledPaymentClaims, assignedGiverByKey, paymentNoteByKey, giverNames]);

  const paymentRows = useMemo<PaymentRow[]>(() => {
    const q = paymentSearch.trim().toLowerCase();
    const minAmount = paymentFilterMinAmount.trim() ? parseFloat(paymentFilterMinAmount) : null;
    const maxAmount = paymentFilterMaxAmount.trim() ? parseFloat(paymentFilterMaxAmount) : null;
    const rows: PaymentRow[] = displayedLoanPayments.map(p => ({
      kind: "payment", key: p.key, status: "completed", date: p.date, amount: p.amount, currency: p.currency,
      note: p.note, addedByCustomer: p.addedByCustomer, payment: p, claim: null,
      giver: giverInfo.giverByRow.get(p.key) ?? null, giverNo: giverInfo.numbers.get(p.key) ?? null, assignKey: p.key,
    }));
    for (const c of unsettledPaymentClaims) {
      if (paymentsMonth && localMonthKey(c.paidAt) !== paymentsMonth) continue;
      if (paymentFilterOn) {
        if (paymentFilterDay && !inPaymentPeriod(localDayKey(c.paidAt))) continue;
        if (minAmount != null && Number.isFinite(minAmount) && c.amount < minAmount) continue;
        if (maxAmount != null && Number.isFinite(maxAmount) && c.amount > maxAmount) continue;
      }
      rows.push({
        kind: "claim", key: `claim:${c.id}`, status: c.status === "pending" ? "pending" : "rejected",
        date: new Date(c.paidAt).getTime(), amount: c.amount, currency: c.currency, note: c.note, addedByCustomer: true, payment: null, claim: c,
        giver: giverInfo.giverByRow.get(`claim:${c.id}`) ?? null, giverNo: giverInfo.numbers.get(`claim:${c.id}`) ?? null, assignKey: claimPaymentKey(c),
      });
    }
    const matching = q
      ? rows.filter(r => [r.note, r.giver, r.payment ? paymentNoteByKey.get(r.payment.key) ?? paymentNoteByKey.get(r.payment.base) : null].some(t => t && t.toLowerCase().includes(q)))
      : rows;
    matching.sort((a, b) => {
      switch (paymentSort) {
        case "date_asc": return a.date - b.date || a.key.localeCompare(b.key);
        default: return b.date - a.date || b.key.localeCompare(a.key);
      }
    });
    return matching;
  }, [displayedLoanPayments, unsettledPaymentClaims, giverInfo, paymentNoteByKey, paymentsMonth, paymentSearch, paymentSort, paymentFilterOn, paymentFilterDay, paymentFilterTo, paymentFilterMinAmount, paymentFilterMaxAmount]);

  // The giver filter narrows the rows before the status chips count them, so every chip
  // and the list agree on what is on screen. The giver chips themselves count over paymentRows.
  const byGiverRows = useMemo(() => {
    if (!paymentGiverFilter) return paymentRows;
    if (paymentGiverFilter === NO_GIVER) return paymentRows.filter(r => !r.giver);
    const want = normalizeGiverText(paymentGiverFilter);
    return paymentRows.filter(r => !!r.giver && normalizeGiverText(r.giver) === want);
  }, [paymentRows, paymentGiverFilter]);
  const giverChips = useMemo(() => {
    const count = (match: (g: string | null) => boolean) => paymentRows.filter(r => match(r.giver)).length;
    const none = count(g => !g);
    return [
      { key: "", label: "", n: paymentRows.length },
      ...giverNames.map(name => ({ key: name, label: name, n: count(g => !!g && normalizeGiverText(g) === normalizeGiverText(name)) })),
      ...(none > 0 && giverNames.length > 0 ? [{ key: NO_GIVER, label: "", n: none }] : []),
    ];
  }, [paymentRows, giverNames]);
  const statusCounts = useMemo(() => {
    const counts = { all: byGiverRows.length, completed: 0, pending: 0, rejected: 0 };
    for (const r of byGiverRows) counts[r.status] += 1;
    return counts;
  }, [byGiverRows]);
  const rowAccent = useMemo(() => {
    const seen = { completed: 0, pending: 0, rejected: 0 };
    const map = new Map<string, string>();
    for (const r of paymentRows) {
      const accents = PAYMENT_STATUS_STYLES[r.status].accents;
      map.set(r.key, accents[seen[r.status] % accents.length]);
      seen[r.status] += 1;
    }
    return map;
  }, [paymentRows]);
  const visibleRows = useMemo(
    () => (statusFilter === "all" ? byGiverRows : byGiverRows.filter(r => r.status === statusFilter)),
    [byGiverRows, statusFilter],
  );
  // How much the rows on screen add up to, per currency; a payment the merchant rejected is not money paid.
  const visibleTotals = useMemo(() => {
    const totals = new Map<string, number>();
    for (const r of visibleRows) if (r.status !== "rejected") totals.set(r.currency, (totals.get(r.currency) ?? 0) + r.amount);
    return [...totals.entries()];
  }, [visibleRows]);

  // What the month shows before search, status and day/amount filters narrow it, so the
  // filter bar can say "showing 8 of 11".
  const monthRowTotal = useMemo(
    () => filteredLoanPayments.length + unsettledPaymentClaims.filter(c => !paymentsMonth || localMonthKey(c.paidAt) === paymentsMonth).length,
    [filteredLoanPayments, unsettledPaymentClaims, paymentsMonth],
  );
  const statusFilterLabel = (f: typeof statusFilter) => (
    f === "completed" ? L("Completed", "مكتمل") : f === "pending" ? L("Processing", "قيد المعالجة") : L("Cancelled", "ملغي")
  );
  const activeFilterTags = [
    ...(paymentSearch.trim() ? [`${L("Search", "بحث")}: «${paymentSearch.trim()}»`] : []),
    ...(statusFilter !== "all" ? [`${L("Status", "الحالة")}: ${statusFilterLabel(statusFilter)}`] : []),
    ...(paymentGiverFilter ? [`${L("Giver", "من سلّم")}: ${paymentGiverFilter === NO_GIVER ? L("No giver", "بدون") : paymentGiverFilter}`] : []),
    ...(paymentFilterOn && paymentFilterDay
      ? [paymentPeriodEnd === paymentFilterDay
        ? `${L("Day", "اليوم")}: ${new Date(`${paymentFilterDay}T00:00`).toLocaleDateString(numLocale, { day: "numeric", month: "long", year: "numeric" })}`
        : `${L("Period", "الفترة")}: ${new Date(`${paymentFilterDay}T00:00`).toLocaleDateString(numLocale, { day: "numeric", month: "short" })} – ${new Date(`${paymentPeriodEnd}T00:00`).toLocaleDateString(numLocale, { day: "numeric", month: "short", year: "numeric" })}`]
      : []),
    ...(paymentFilterOn && (paymentFilterMinAmount.trim() || paymentFilterMaxAmount.trim())
      ? [`${L("Amount", "المبلغ")}: ${paymentFilterMinAmount.trim() || "0"}–${paymentFilterMaxAmount.trim() || "∞"}`] : []),
  ];
  const clearAllFilters = () => {
    setPaymentSearch("");
    setStatusFilter("all");
    setPaymentFilterOn(false);
    setPaymentFilterDay("");
    setPaymentFilterTo("");
    setPaymentFilterMinAmount("");
    setPaymentFilterMaxAmount("");
    setPaymentGiverFilter("");
  };

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
  // Same rule as the Orders page's growth card: down only when last month had more.
  const trendDown = !!monthOverMonth?.previous && monthOverMonth.current.total < monthOverMonth.previous.total;

  return (
    <div className="ch-root co-root cw-root" dir={lang === "ar" ? "rtl" : "ltr"}>
      {/* The Accounts tab is hidden; with Payments the only tab left there is nothing to switch between. */}
      {isPhone && (
        <section className="co-hero2">
          <div className="co-hero2-bg" aria-hidden="true" />
          <div className="co-top">
            <ZoomControls variant="hero" label={L("Zoom", "تكبير")} />
            <div className="co-ctl">
              <button type="button" className="ch-bell" onClick={() => navigate("/c/notifications")} aria-label={L("Notifications", "التنبيهات")}>
                <Bell strokeWidth={2} />
                {unreadCount > 0 && <span className="ch-badge">{unreadCount > 9 ? "9+" : unreadCount}</span>}
              </button>
              <div className="ch-pill" role="group" aria-label={L("Language", "اللغة")}>
                <button type="button" className={lang === "ar" ? "on" : ""} onClick={() => update({ language: "ar" })}>AR</button>
                <button type="button" className={lang === "en" ? "on" : ""} onClick={() => update({ language: "en" })}>EN</button>
              </div>
            </div>
          </div>
          <div className="co-idrow">
            <div className="co-who">
              <div className="ch-avatar"><User fill="#fff" stroke="#fff" /></div>
              <div>
                <div className="ch-name">{displayName}</div>
                <div className="ch-greet">{L("Welcome to your dashboard", "مرحباً بك في لوحة التحكم")}</div>
              </div>
            </div>
          </div>
          <div className="co-head">
            <div className="co-ttl">
              <div className="co-ttl-row">
                <Wallet2 className="co-ttl-ic" strokeWidth={1.7} />
                <h1>{L("Cash", "النقد")}</h1>
              </div>
              <p>{L("Follow your payments with ease", "تابع جميع دفعاتك وإحصائياتك بسهولة")}</p>
            </div>
            <div className="co-grow">
              <svg className="co-grow-ic" viewBox="0 0 16 18" aria-hidden="true">
                <defs><linearGradient id="co-gbars" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stopColor="#22c58b" /><stop offset="1" stopColor="#3b82f6" /></linearGradient></defs>
                <rect x="0" y="11" width="3" height="7" rx="1" fill="url(#co-gbars)" />
                <rect x="4.3" y="7" width="3" height="11" rx="1" fill="url(#co-gbars)" />
                <rect x="8.6" y="4" width="3" height="14" rx="1" fill="url(#co-gbars)" />
                <rect x="12.9" y="0" width="3" height="18" rx="1" fill="url(#co-gbars)" />
              </svg>
              <div>
                <b>{trendDown ? L("Slower this month", "تراجع هذا الشهر") : L("Steady growth", "نمو مستمر")}</b>
                <span>{trendDown ? L("Your payments are down", "دفعاتك في انخفاض") : L("Your payments are rising", "دفعاتك في ارتفاع")}</span>
              </div>
              {trendDown ? <ArrowDownRight className="co-grow-arrow down" strokeWidth={2.4} /> : <ArrowUpRight className="co-grow-arrow" strokeWidth={2.4} />}
            </div>
          </div>
        </section>
      )}

      {isLoading ? (
        <div className="cw-loading"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : (
        <div className="cw-body">
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
            <>
              {/* Main card — month row with the button, month chips, tools and the figures, as on the Orders page. */}
              <div className="co-mainwrap">
                <div className="ch-card co-main">
                  <div className="co-mtop">
                    <div className="co-mlabel">{L("Month", "الشهر")}</div>
                    <button type="button" className="co-new" onClick={() => setShowLogPayment(true)} disabled={statementLinks.length === 0}>
                      <Plus strokeWidth={2.4} />
                      {L("Log a Payment", "تسجيل دفعة")}
                    </button>
                  </div>
              {/* Months */}
              <div className="cw-months">
                <div className="co-months">
                  {[{ key: null as string | null, label: L("All Months", "كل الأشهر") }, ...paymentsMonths.map(m => ({ key: m as string | null, label: monthPillLabel(m) }))].map(m => (
                    <button
                      key={m.key ?? "all"}
                      type="button"
                      className={cn("co-chip", paymentsMonth === m.key && "on")}
                      onClick={() => { userPickedPaymentsMonth.current = true; setPaymentsMonth(m.key); }}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
                <button type="button" className="cw-card cw-cal" onClick={() => setShowPaymentFilter(true)} aria-label={L("Filter by day or amount", "تصفية حسب اليوم أو المبلغ")}>
                  <CalendarDays />
                </button>
              </div>

              {/* Search, exports, filter */}
              <div className="cw-tools">
                <label className="cw-search">
                  <Search />
                  <input
                    value={paymentSearch}
                    onChange={e => setPaymentSearch(e.target.value)}
                    placeholder={L("Search...", "بحث...")}
                  />
                </label>
                <button type="button" className="cw-card cw-tool xlsx" disabled={exportingFormat !== null} onClick={() => exportStatement(paymentsMonth, paymentsMonths, "xlsx")}>
                  XLSX
                  {exportingFormat === "xlsx" ? <Loader2 className="animate-spin" /> : <FileSpreadsheet />}
                </button>
                <button type="button" className="cw-card cw-tool pdf" disabled={exportingFormat !== null} onClick={() => exportStatement(paymentsMonth, paymentsMonths, "pdf")}>
                  PDF
                  {exportingFormat === "pdf" ? <Loader2 className="animate-spin" /> : <FilePlus />}
                </button>
                <div style={{ position: "relative", minWidth: 0 }}>
                  <button type="button" className="cw-card cw-tool" style={{ width: "100%" }} onClick={() => setShowExportMenu(o => !o)}>
                    {L("Export", "تصدير")}
                    <ChevronDown />
                  </button>
                  {showExportMenu && (
                    <>
                      <div className="cw-scrim" onClick={() => setShowExportMenu(false)} />
                      <div className="cw-pop">
                        <button type="button" onClick={() => { setShowExportMenu(false); exportStatement(paymentsMonth, paymentsMonths, "pdf"); }}>
                          <FilePlus style={{ color: "#1f63f0" }} /> {L("PDF statement", "كشف PDF")}
                        </button>
                        <button type="button" onClick={() => { setShowExportMenu(false); exportStatement(paymentsMonth, paymentsMonths, "xlsx"); }}>
                          <FileSpreadsheet style={{ color: "#16a34a" }} /> {L("Excel statement", "كشف Excel")}
                        </button>
                      </div>
                    </>
                  )}
                </div>
                <button
                  type="button"
                  className={cn("cw-card cw-tool", activePaymentFilterCount > 0 && "on")}
                  onClick={() => {
                    if (!hasPaymentFilterCriteria) { setShowPaymentFilter(true); return; }
                    setPaymentFilterOn(on => !on);
                  }}
                >
                  {L("Filter", "تصفية")}
                  {activePaymentFilterCount > 0 ? <span className="cw-tool-n">{activePaymentFilterCount}</span> : <Filter />}
                </button>
              </div>

              {/* Filters: a day or period, and who handed over the cash. They combine with the search and the amount filter. */}
              <div className="cw-fltrow">
                <DateRangeFilterDropdown
                  from={paymentFilterOn ? paymentFilterDay : ""}
                  to={paymentFilterOn ? paymentFilterTo : ""}
                  onChange={setPaymentPeriod}
                  lang={lang === "ar" ? "ar" : "en"}
                  title={L("Filter by day or period", "تصفية حسب اليوم أو الفترة")}
                  triggerClassName="cw-card cw-tool cw-dayfilter"
                  triggerActiveClassName="on"
                  emptyLabel={L("By date", "حسب التاريخ")}
                />
                <div className="cw-gchips" role="group" aria-label={L("Cash giver", "من سلّم المبلغ")}>
                  {giverChips.map(c => (
                    <button
                      key={c.key || "all"}
                      type="button"
                      className={cn("cw-gchip", paymentGiverFilter === c.key && "on")}
                      onClick={() => setPaymentGiverFilter(paymentGiverFilter === c.key ? "" : c.key)}
                    >
                      {c.key === "" ? L("All givers", "كل من سلّم") : c.key === NO_GIVER ? L("No giver", "بدون") : c.label}
                      <span>{c.n}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Headline figures */}
              <div className="cw-stats">
                {[
                  { cls: "t1", label: L("Total", "الإجمالي"), value: loanTotals.totalDebt, icon: <Database />, bg: "#e6dcff", fg: "#6d28d9", bar: null as number | null, barFill: "" },
                  { cls: "t2", label: L("Paid", "المدفوع"), value: loanTotals.totalPaid, icon: <ArrowLeftRight />, bg: "#d3e3ff", fg: "#1d4ed8", bar: loanTotals.settledPct, barFill: "linear-gradient(90deg,#3b82f6,#60a5fa)" },
                  { cls: "t3", label: L("Remaining", "المتبقي"), value: loanTotals.outstanding, icon: <MoneyBagIcon />, bg: "#cdf1de", fg: "#15803d", bar: 100 - loanTotals.settledPct, barFill: "linear-gradient(90deg,#10b981,#34d399)" },
                ].map(c => (
                  <div key={c.label} className={`cw-card cw-stat ${c.cls}`}>
                    <div className="cw-stat-t">
                      <div className="cw-stat-l">{c.label}</div>
                      <div className="cw-stat-v">{fmtTotal(c.value)}</div>
                      <div className="cw-stat-u">({loanTotals.currency})</div>
                      {c.bar !== null && (
                        <div className="cw-stat-b">
                          <div className="cw-stat-track"><div style={{ width: `${c.bar}%`, background: c.barFill }} /></div>
                          <span style={{ color: c.fg }}>{c.bar}%</span>
                        </div>
                      )}
                    </div>
                    <span className="cw-stat-ic" style={{ background: c.bg, color: c.fg }}>{c.icon}</span>
                  </div>
                ))}
              </div>

              {/* The one counter: every payment registered or waiting on the merchant. */}
              <div className="cw-card cw-kpi1">
                <span className="cw-kpi-ic" style={{ background: "#d3e3ff", color: "#1d4ed8" }}><Wallet2 /></span>
                <span className="cw-kpi1-l">{L("Total payments", "إجمالي الدفعات")}</span>
                <b className="cw-kpi1-v">{overallCounts.completed + overallCounts.pending}</b>
              </div>

              {/* Settlement */}
              <div className="cw-card cw-settle">
                <div className="cw-settle-t">
                  <div className="cw-settle-ttl" dir={lang === "ar" ? "rtl" : "ltr"} style={{ textAlign: "left" }}>{L("Total Settled", "إجمالي المسدد")}</div>
                  <div className="cw-settle-v">
                    <b>{fmtTotal(loanTotals.totalPaid)}</b>
                    <span>/ {fmtTotal(loanTotals.totalDebt)} ({loanTotals.currency})</span>
                  </div>
                  <div className="cw-settle-track"><div className="cw-settle-fill" style={{ width: `${loanTotals.settledPct}%` }} /></div>
                </div>
                <div className="cw-ring">
                  <svg viewBox="0 0 64 64">
                    <circle cx="32" cy="32" r="27" fill="none" stroke="#dcf5ea" strokeWidth="7" />
                    <circle
                      cx="32" cy="32" r="27" fill="none" stroke="#10b981" strokeWidth="7" strokeLinecap="round"
                      strokeDasharray={2 * Math.PI * 27}
                      strokeDashoffset={2 * Math.PI * 27 * (1 - loanTotals.settledPct / 100)}
                    />
                  </svg>
                  <b>{loanTotals.settledPct}%</b>
                </div>
              </div>

                </div>
              </div>

              {/* Status chips */}
              <div className="cw-card cw-chips">
                {([
                  { key: "all", cls: "all", label: L("All", "الكل"), icon: <ListIcon />, count: statusCounts.all },
                  { key: "completed", cls: "done", label: L("Done", "مكتمل"), icon: <Check />, count: statusCounts.completed },
                  { key: "pending", cls: "wait", label: L("Pending", "قيد المعالجة"), icon: <Clock />, count: statusCounts.pending },
                  { key: "rejected", cls: "void", label: L("Cancelled", "ملغي"), icon: <X />, count: statusCounts.rejected },
                ] as const).map(s => (
                  <button key={s.key} type="button" className={cn("cw-chip", s.cls, statusFilter === s.key && "on")} onClick={() => setStatusFilter(s.key)}>
                    <span className="cw-chip-ic">{s.icon}</span>
                    <span className="cw-chip-l">{s.label}</span>
                    <span className="cw-chip-n">{s.count}</span>
                  </button>
                ))}
              </div>

              {/* Count + sort */}
              <div className="cw-sortrow">
                <span className="cw-count">{visibleRows.length} {L("payments", "دفعة")}</span>
                <button
                  type="button"
                  className="cw-card cw-sort"
                  onClick={() => setPaymentSort(s => (s === "date_desc" ? "date_asc" : "date_desc"))}
                >
                  <ArrowUpDown />
                  {paymentSort === "date_desc" ? L("Newest first", "الأحدث أولاً") : L("Oldest first", "الأقدم أولاً")}
                  <ChevronDown className="chev" />
                </button>
              </div>

              {/* Shown whenever something is narrowing the list, so a short list is never mistaken for missing payments. */}
              {activeFilterTags.length > 0 && (
                <div className="cw-fbar" role="status">
                  <Filter className="cw-fbar-ic" />
                  <div className="cw-fbar-t">
                    <span>{L("Showing", "يعرض")} <b>{visibleRows.length}</b> {L("of", "من")} <b>{monthRowTotal}</b></span>
                    <span className="cw-fbar-tags">{activeFilterTags.map(t => <i key={t}>{t}</i>)}</span>
                    <span className="cw-fbar-sum">
                      {L("Total", "الإجمالي")}:{" "}
                      {visibleTotals.length === 0 ? <b>0</b> : visibleTotals.map(([cur, sum], i) => <span key={cur}>{i > 0 && " · "}<b>{fmtTotal(sum)}</b> {cur}</span>)}
                    </span>
                  </div>
                  <button type="button" className="cw-fbar-clear" onClick={clearAllFilters}>
                    <X />{L("Clear", "مسح")}
                  </button>
                </div>
              )}

              {/* Cards */}
              {visibleRows.length === 0 ? (
                <div className="cw-card cw-empty" style={{ marginTop: "calc(5 * var(--q))" }}>
                  {loanPayments.length === 0 && unsettledPaymentClaims.length === 0
                    ? L("No payments recorded yet", "لا توجد دفعات مسجلة بعد")
                    : paymentRows.length === 0 && !paymentSearch.trim() && !paymentFilterOn
                    ? L("No payments this month", "لا توجد دفعات هذا الشهر")
                    : L("No payments match your search", "لا توجد دفعات مطابقة لبحثك")}
                </div>
              ) : (
                <div className="cw-list">
                  {visibleRows.map(r => {
                    const st = PAYMENT_STATUS_STYLES[r.status];
                    const accent = rowAccent.get(r.key) ?? st.accents[0];
                    const pill = r.status === "completed" ? { background: "#dcf7e6", color: "#15803d", dot: "#16a34a" } : { background: `${accent}1f`, color: accent, dot: accent };
                    const p = r.payment;
                    const seq = paymentSequence.get(r.key);
                    const myNote = p ? paymentNoteByKey.get(p.key) ?? paymentNoteByKey.get(p.base) ?? "" : "";
                    const isEditingNote = !!p && editingNoteKey === p.key;
                    const correction = p ? resolveCorrection(p) : null;
                    const claim = r.claim;
                    const claimEditable = !!claim && r.status === "pending";
                    const confirmingClaimDelete = !!claim && deleteClaimPromptId === claim.id;
                    const expanded = expandedPaymentKey === r.key;
                    const toggleDetails = () => { setMenuRowKey(null); setExpandedPaymentKey(k => (k === r.key ? null : r.key)); };
                    const sourceLabel = r.addedByCustomer ? L("By me", "أضفتها أنا") : L("Merchant", "أضافها التاجر");
                    const StatusIcon = st.Icon;

                    return (
                      <div key={r.key} className={cn("cw-card cw-row", r.status === "pending" && "pending")} style={{ ["--acc" as string]: accent }}>
                        <div className="cw-row-in">
                          <div className="cw-main">
                            <div className="cw-r1">
                              <button type="button" className={cn("cw-chev", expanded && "open")} onClick={toggleDetails} aria-label={L("Details", "تفاصيل")}>
                                <ChevronRight />
                              </button>
                              <span className="cw-status" style={{ background: pill.background, color: pill.color }}>
                                <span className="cw-status-ic" style={{ background: pill.dot }}><StatusIcon /></span>
                                {st.label(L)}
                              </span>
                              <div className="cw-amt">
                                <div className="cw-amt-v" style={{ color: accent }}><bdi dir="ltr">{r.currency} {fmtTotal(r.amount)}</bdi></div>
                                {(r.giver || r.note) && <div className="cw-amt-s">{r.giver ? (lang === "ar" ? `${r.giver} دفعة${r.giverNo ? ` ${r.giverNo}` : ""}` : `${r.giver}${r.giverNo ? ` · ${r.giverNo}` : ""}`) : r.note}</div>}
                              </div>
                              <span className={cn("cw-src", !r.addedByCustomer && "merchant")}>
                                <Info fill="currentColor" stroke="#fff" strokeWidth={2.5} />
                                <span>{sourceLabel}</span>
                              </span>
                              <div className="cw-when">
                                <span><CalendarDays />{cardDateLabel(r.date)}</span>
                                <span className="t"><Clock />{cardTimeLabel(r.date)}</span>
                              </div>
                            </div>

                            {r.status === "pending" && (
                              <div className="cw-pend">
                                <span className="cw-pend-dot" />
                                {L("Waiting for the merchant to confirm — not counted yet", "بانتظار تأكيد التاجر — لم تُحتسب بعد")}
                              </div>
                            )}

                            {isEditingNote && p && (
                              <div className="cw-note-ed">
                                <input
                                  autoFocus
                                  value={noteDraft}
                                  onChange={e => setNoteDraft(e.target.value)}
                                  placeholder={L("Add a note...", "أضف ملاحظة...")}
                                  onKeyDown={e => {
                                    if (e.key === "Enter") { savePaymentNote.mutate({ key: p.key, note: noteDraft.trim() }); setEditingNoteKey(null); }
                                    if (e.key === "Escape") setEditingNoteKey(null);
                                  }}
                                />
                                <button type="button" onClick={() => { savePaymentNote.mutate({ key: p.key, note: noteDraft.trim() }); setEditingNoteKey(null); }}>
                                  <Check />
                                </button>
                              </div>
                            )}

                            {/* Edit/delete only appear when the row can be tied to a
                                correction (own claim, or a single merchant-entered
                                payment); either way it is a request the merchant
                                applies, since the repayment sits in their books. */}
                            <div className="cw-acts">
                              {p && !isEditingNote && (
                                myNote ? (
                                  <button type="button" className="cw-act note" onClick={() => { setEditingNoteKey(p.key); setNoteDraft(myNote); }}>
                                    <MessageSquare /><span>{myNote}</span>
                                  </button>
                                ) : (
                                  <button type="button" className="cw-act" onClick={() => { setEditingNoteKey(p.key); setNoteDraft(""); }}>
                                    <MessageSquare />{L("Add note", "إضافة ملاحظة")}
                                  </button>
                                )
                              )}

                              {correction && (
                                correction.changeRequest ? (
                                  <>
                                    <span className="cw-act req">
                                      {correction.changeRequest === "delete" ? L("Removal requested", "طُلب الحذف") : L("Change requested", "طُلب التعديل")}
                                    </span>
                                    <button type="button" className="cw-act" onClick={correction.onCancelRequest}>{L("Cancel request", "إلغاء الطلب")}</button>
                                  </>
                                ) : deletePaymentPromptKey === r.key ? (
                                  <>
                                    <span className="cw-act ask">{L("Ask the merchant to remove this payment?", "طلب حذف هذه الدفعة من التاجر؟")}</span>
                                    <button type="button" className="cw-mini danger" onClick={() => { correction.onRequestDelete(); setDeletePaymentPromptKey(null); }}>{L("Request", "إرسال")}</button>
                                    <button type="button" className="cw-mini" onClick={() => setDeletePaymentPromptKey(null)}>{L("Cancel", "إلغاء")}</button>
                                  </>
                                ) : (
                                  <>
                                    <button type="button" className="cw-act" onClick={correction.onEdit}><Pencil />{L("Edit", "تعديل")}</button>
                                    <button type="button" className="cw-act" onClick={() => setDeletePaymentPromptKey(r.key)}><Trash2 />{L("Delete", "حذف")}</button>
                                  </>
                                )
                              )}

                              {claimEditable && (
                                confirmingClaimDelete ? (
                                  <>
                                    <span className="cw-act ask">{L("Delete this reported payment?", "حذف هذه الدفعة المُبلغ عنها؟")}</span>
                                    <button type="button" className="cw-mini danger" onClick={() => { deleteClaim.mutate(claim.id); setDeleteClaimPromptId(null); }}>{L("Delete", "حذف")}</button>
                                    <button type="button" className="cw-mini" onClick={() => setDeleteClaimPromptId(null)}>{L("Cancel", "إلغاء")}</button>
                                  </>
                                ) : (
                                  <>
                                    <button type="button" className="cw-act" onClick={() => setEditingClaimId(claim.id)}><Pencil />{L("Edit", "تعديل")}</button>
                                    <button type="button" className="cw-act" onClick={() => setDeleteClaimPromptId(claim.id)}><Trash2 />{L("Delete", "حذف")}</button>
                                  </>
                                )
                              )}

                              <button type="button" className="cw-act" onClick={toggleDetails}>{L("View details", "عرض التفاصيل")}<ListIcon /></button>
                            </div>

                            {expanded && (
                              <div className="cw-det">
                                <div><span>{L("Time", "الوقت")}</span><b>{cardTimeLabel(r.date)}</b></div>
                                <div><span>{L("Currency", "العملة")}</span><b>{r.currency}</b></div>
                                <div><span>{L("Source", "المصدر")}</span><b>{sourceLabel}</b></div>
                                <div><span>{L("Status", "الحالة")}</span><b>{st.label(L)}</b></div>
                                {r.giver && <div><span>{L("Cash giver", "من سلّم المبلغ")}</span><b>{r.giver}</b></div>}
                                {r.giverNo && <div><span>{L("Payment no.", "رقم الدفعة")}</span><b>{r.giverNo}</b></div>}
                                {r.note && r.giver && normalizeGiverText(r.note) !== normalizeGiverText(r.giver) && (
                                  <div style={{ gridColumn: "1 / -1" }}><span>{L("Note", "ملاحظة")}</span><b>{r.note}</b></div>
                                )}
                              </div>
                            )}
                          </div>

                          <div className="cw-side">
                            {seq != null ? <span className="cw-num">#{seq}</span> : <span />}
                            <button type="button" className="cw-dots" onClick={() => setMenuRowKey(k => (k === r.key ? null : r.key))} aria-label={L("More", "المزيد")}>
                              <MoreHorizontal />
                            </button>
                            {menuRowKey === r.key && (
                              <>
                                <div className="cw-scrim" onClick={() => setMenuRowKey(null)} />
                                <div className="cw-pop">
                                  <button type="button" onClick={toggleDetails}><ListIcon /> {L("View details", "عرض التفاصيل")}</button>
                                  <button type="button" onClick={() => { setMenuRowKey(null); setGiverPicker({ key: r.assignKey, current: r.giver }); }}>
                                    <Users /> {L("Cash giver", "من سلّم المبلغ")}
                                  </button>
                                  {p && (
                                    <button type="button" onClick={() => { setMenuRowKey(null); setEditingNoteKey(p.key); setNoteDraft(myNote); }}>
                                      <MessageSquare /> {myNote ? L("Edit note", "تعديل الملاحظة") : L("Add note", "إضافة ملاحظة")}
                                    </button>
                                  )}
                                  {correction && !correction.changeRequest && (
                                    <>
                                      <button type="button" onClick={() => { setMenuRowKey(null); correction.onEdit(); }}><Pencil /> {L("Edit", "تعديل")}</button>
                                      <button type="button" className="danger" onClick={() => { setMenuRowKey(null); setDeletePaymentPromptKey(r.key); }}><Trash2 /> {L("Delete", "حذف")}</button>
                                    </>
                                  )}
                                  {claimEditable && (
                                    <>
                                      <button type="button" onClick={() => { setMenuRowKey(null); setEditingClaimId(claim.id); }}><Pencil /> {L("Edit", "تعديل")}</button>
                                      <button type="button" className="danger" onClick={() => { setMenuRowKey(null); setDeleteClaimPromptId(claim.id); }}><Trash2 /> {L("Delete", "حذف")}</button>
                                    </>
                                  )}
                                </div>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
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
                      onClick={() => { setPaymentFilterDay(key); setPaymentFilterTo(""); setPaymentFilterOn(true); setShowPaymentFilter(false); }}
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
                  setPaymentFilterTo("");
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
                onClick={() => { setPaymentFilterDay(""); setPaymentFilterTo(""); setPaymentFilterMinAmount(""); setPaymentFilterMaxAmount(""); setPaymentFilterOn(false); }}
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
          givers={giverNames} onAddGiver={name => addGiver.mutateAsync(name)}
          onClose={() => setShowLogPayment(false)}
          onSave={input => {
            submitClaim.mutate(input, {
              onSuccess: () => {
                setShowLogPayment(false);
                // Show the new payment straight away: drop any filter that could hide it and open its month.
                clearAllFilters();
                userPickedPaymentsMonth.current = true;
                setPaymentsMonth(localMonthKey(input.paidAt));
              },
            });
          }} />
      )}
      {editingClaim && (
        <LogPaymentModal lang={lang} links={statementLinks}
          saving={editingClaim.status === "accepted" ? requestChange.isPending : updateClaim.isPending}
          givers={giverNames} onAddGiver={name => addGiver.mutateAsync(name)}
          existing={{
            id: editingClaim.id, currency: editingClaim.currency, amount: editingClaim.amount, note: editingClaim.note, paidAt: editingClaim.paidAt,
            giver: resolveGiver(assignedGiverByKey.get(claimPaymentKey(editingClaim)), [editingClaim.note], giverNames),
          }}
          needsApproval={editingClaim.status === "accepted"}
          onClose={() => setEditingClaimId(null)}
          onSave={input => {
            // A claim the merchant already accepted has become a repayment
            // in their tracker -- correcting it is a request they apply,
            // not a write this side can make.
            // The note carries the new giver; an explicit tag on the old payment would outrank it.
            const oldGiver = resolveGiver(assignedGiverByKey.get(claimPaymentKey(editingClaim)), [editingClaim.note], giverNames);
            if (input.giver && input.giver !== oldGiver) assignGiver.mutate({ key: claimPaymentKey(editingClaim), giver: editingClaim.status === "accepted" ? input.giver : null });
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
      {giverPicker && (
        <GiverPickerModal lang={lang} givers={giverNames} current={giverPicker.current}
          onClose={() => setGiverPicker(null)}
          onAdd={name => addGiver.mutateAsync(name)}
          onDelete={name => deleteGiver.mutate(name)}
          onPick={name => { assignGiver.mutate({ key: giverPicker.key, giver: name }); setGiverPicker(null); }} />
      )}
      {editingMerchantPayment && (
        <LogPaymentModal
          lang={lang}
          links={statementLinks}
          saving={requestMerchantPaymentChange.isPending}
          givers={giverNames} onAddGiver={name => addGiver.mutateAsync(name)}
          existing={{
            id: editingMerchantPayment.bucket, currency: editingMerchantPayment.currency,
            amount: editingMerchantPayment.amount, note: editingMerchantPayment.note,
            paidAt: new Date(editingMerchantPayment.date).toISOString(),
            giver: resolveGiver(assignedGiverByKey.get(editingMerchantPayment.bucket), [editingMerchantPayment.note, paymentNoteByKey.get(editingMerchantPayment.bucket)], giverNames),
          }}
          needsApproval
          onClose={() => setEditingMerchantPayment(null)}
          onSave={input => {
            const link = statementLinks.find(l => l.currency === editingMerchantPayment.currency);
            if (!link) return;
            const oldGiver = resolveGiver(assignedGiverByKey.get(editingMerchantPayment.bucket), [editingMerchantPayment.note, paymentNoteByKey.get(editingMerchantPayment.bucket)], giverNames);
            if (input.giver && input.giver !== oldGiver) assignGiver.mutate({ key: editingMerchantPayment.bucket, giver: input.giver });
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
