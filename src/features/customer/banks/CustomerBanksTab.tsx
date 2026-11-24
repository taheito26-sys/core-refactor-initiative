import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ArrowDownLeft, ArrowLeftRight, ArrowUpRight, BarChart3, CalendarDays, Check, ChevronDown, Crown, Edit2, Landmark,
  FileUp, Loader2, Plus, Search, Send, Trash2, Trophy, Users, X, Zap,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/auth-context';
import { cn } from '@/lib/utils';
import { fmtTotal } from '@/lib/tracker-helpers';
import { QuickDateField } from '@/components/shared/QuickDateField';
import { ModernSelect } from '@/components/shared/ModernSelect';
import { statementQueryOptions } from '@/features/customer/statements-api';
import type { PublicStatement } from '@/features/stock/components/PublicStatementReport';
import {
  NO_PAYEE_KEY, accountBalances, activeAccounts, buildBankMoves, cleanPayeeName, encodePayeeNote, isIncome, isSpending,
  knownPayees, merchantOrdersFromStatements, monthKeyOf, dayKeyOf, orderLinkId, ordersStartOf, payeeKey, primaryAccountId,
  runningBalances, summarizeMoves, type BankAccount, type BankLedgerRow, type BankMove,
} from './bank-book';
import {
  mergeBeneficiaries, parseBankImport, planImport, readBeneficiaries, writeBeneficiaries,
  type BankImportFile, type ImportPlan,
} from './bank-import';
import '@/styles/customer-banks.css';

type Lang = 'en' | 'ar';
type Tr = (en: string, ar: string) => string;

const ACCOUNT_TYPES: Array<{ value: string; en: string; ar: string }> = [
  { value: 'bank', en: 'Bank', ar: 'بنك' },
  { value: 'mobile_wallet', en: 'Mobile wallet', ar: 'محفظة موبايل' },
  { value: 'cash', en: 'Cash in hand', ar: 'نقد باليد' },
  { value: 'other', en: 'Other', ar: 'أخرى' },
];
const CURRENCIES = ['EGP', 'QAR', 'USD', 'SAR', 'AED', 'USDT'];
// One colour per payee rank, so the same person keeps their colour in the list and the bar.
const RANK_COLORS = ['#2563eb', '#7c3aed', '#db2777', '#ea580c', '#0d9488', '#64748b'];

function newId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

function todayStr(): string {
  return dayKeyOf(Date.now());
}

function dateStrOf(ts: number): string {
  return dayKeyOf(ts);
}

/** Today keeps the current time so same-day entries stay in order; another day is pinned to its noon. */
function tsOfDateStr(s: string, keepTs?: number): number {
  if (!s) return Date.now();
  if (keepTs && dayKeyOf(keepTs) === s) return keepTs;
  if (s === todayStr()) return Date.now();
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d, 12).getTime();
}

function startOfDayStr(s: string): number {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
}

// ─── Bottom sheet ─────────────────────────────────────────────────

function Sheet({ title, sub, onClose, children, lang }: { title: string; sub?: string; onClose: () => void; children: ReactNode; lang: Lang }) {
  return (
    <div className="bk-sheet-bg" onClick={onClose}>
      <div className="bk-sheet" dir={lang === 'ar' ? 'rtl' : 'ltr'} onClick={e => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className="bk-sheet-h">
          <div>
            <b>{title}</b>
            {sub && <span>{sub}</span>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close"><X /></button>
        </div>
        <div className="bk-sheet-b">{children}</div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="bk-field">
      <span>{label}</span>
      {children}
    </div>
  );
}

// ─── Account form ─────────────────────────────────────────────────

function AccountSheet({ existing, onClose, lang, L, onSave, saving }: {
  existing: BankAccount | null; onClose: () => void; lang: Lang; L: Tr; saving: boolean;
  onSave: (v: { name: string; type: string; currency: string; opening: number; startTs: number }) => void;
}) {
  const [name, setName] = useState(existing?.name ?? '');
  const [type, setType] = useState(existing?.type ?? 'bank');
  const [currency, setCurrency] = useState(existing?.currency ?? 'EGP');
  const [opening, setOpening] = useState('');
  const [from, setFrom] = useState(existing ? dateStrOf(ordersStartOf(existing)) : todayStr());
  const [err, setErr] = useState('');

  const submit = () => {
    if (!name.trim()) { setErr(L('Enter the account name', 'أدخل اسم الحساب')); return; }
    const op = parseFloat(opening) || 0;
    if (op < 0) { setErr(L('Opening balance cannot be negative', 'الرصيد الافتتاحي لا يمكن أن يكون سالباً')); return; }
    onSave({ name: name.trim(), type, currency, opening: op, startTs: startOfDayStr(from) });
  };

  return (
    <Sheet lang={lang} onClose={onClose} title={existing ? L('Edit account', 'تعديل الحساب') : L('Add a bank account', 'إضافة حساب بنكي')}
      sub={L('Orders from your merchant are deposited here automatically', 'طلبات التاجر تُودع هنا تلقائياً')}>
      <Field label={L('Account name', 'اسم الحساب')}>
        <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder={L('e.g. Bank Misr', 'مثال: بنك مصر')} />
      </Field>
      <div className="bk-2">
        <Field label={L('Type', 'النوع')}>
          <ModernSelect className="bk-select" value={type} onChange={e => setType(e.target.value)}>
            {ACCOUNT_TYPES.map(t => <option key={t.value} value={t.value}>{lang === 'ar' ? t.ar : t.en}</option>)}
          </ModernSelect>
        </Field>
        <Field label={L('Currency', 'العملة')}>
          <ModernSelect className="bk-select" value={currency} onChange={e => setCurrency(e.target.value)} disabled={!!existing}>
            {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
          </ModernSelect>
        </Field>
      </div>
      {!existing && (
        <Field label={L('Current balance (optional)', 'الرصيد الحالي (اختياري)')}>
          <input inputMode="decimal" value={opening} onChange={e => setOpening(e.target.value)} placeholder="0" />
        </Field>
      )}
      <Field label={L('Count merchant orders from', 'احتساب طلبات التاجر من تاريخ')}>
        <QuickDateField value={from} onChange={setFrom} lang={lang} />
      </Field>
      <p className="bk-hint">{L('Orders dated on or after this day are added to the balance of your primary account.', 'الطلبات بهذا التاريخ أو بعده تُضاف إلى رصيد حسابك الرئيسي.')}</p>
      {err && <p className="bk-err">{err}</p>}
      <div className="bk-btns">
        <button type="button" className="bk-btn ghost" onClick={onClose}>{L('Cancel', 'إلغاء')}</button>
        <button type="button" className="bk-btn" onClick={submit} disabled={saving}>{saving ? <Loader2 className="animate-spin" /> : <Check />}{L('Save', 'حفظ')}</button>
      </div>
    </Sheet>
  );
}

// ─── Send money / add money / move between accounts ──────────────

type EntryMode = 'out' | 'in' | 'move';

function EntrySheet({ mode, accounts, balances, defaultAccountId, payees, existing, onClose, lang, L, onSave, saving }: {
  mode: EntryMode; accounts: BankAccount[]; balances: Map<string, number>; defaultAccountId: string | null;
  payees: string[]; existing: BankMove | null; onClose: () => void; lang: Lang; L: Tr; saving: boolean;
  onSave: (v: { accountId: string; toAccountId: string | null; amount: number; ts: number; payee: string | null; note: string | null }) => void;
}) {
  const [accountId, setAccountId] = useState(existing?.accountId ?? defaultAccountId ?? accounts[0]?.id ?? '');
  const acc = accounts.find(a => a.id === accountId) ?? null;
  const others = accounts.filter(a => a.id !== accountId && a.currency === acc?.currency);
  const [toId, setToId] = useState(others[0]?.id ?? '');
  const [amount, setAmount] = useState(existing ? String(existing.amount) : '');
  const [payee, setPayee] = useState(existing?.payee ?? '');
  const [note, setNote] = useState(existing?.note ?? '');
  const [date, setDate] = useState(existing ? dateStrOf(existing.ts) : todayStr());
  const [err, setErr] = useState('');
  useEffect(() => { if (!others.some(o => o.id === toId)) setToId(others[0]?.id ?? ''); }, [accountId]); // eslint-disable-line react-hooks/exhaustive-deps

  const amt = parseFloat(amount) || 0;
  const bal = (balances.get(accountId) ?? 0) + (existing && existing.accountId === accountId ? (existing.direction === 'out' ? existing.amount : -existing.amount) : 0);
  const after = mode === 'in' ? bal + amt : bal - amt;
  const typed = payeeKey(payee);
  const suggestions = payees.filter(p => !typed || (payeeKey(p).includes(typed) && payeeKey(p) !== typed)).slice(0, 8);

  const submit = () => {
    if (!acc) { setErr(L('Pick an account', 'اختر حساباً')); return; }
    if (!(amt > 0)) { setErr(L('Enter a valid amount', 'أدخل مبلغاً صحيحاً')); return; }
    if (mode === 'out' && !cleanPayeeName(payee)) { setErr(L('Who did you send it to?', 'لمن أرسلت المبلغ؟')); return; }
    if (mode === 'move' && !toId) { setErr(L('Pick the account to move to', 'اختر الحساب المحوّل إليه')); return; }
    onSave({ accountId, toAccountId: mode === 'move' ? toId : null, amount: amt, ts: tsOfDateStr(date, existing?.ts), payee: mode === 'out' ? cleanPayeeName(payee) : null, note: note.trim() || null });
  };

  const title = mode === 'out'
    ? (existing ? L('Edit transfer', 'تعديل التحويل') : L('Send money', 'تحويل مبلغ'))
    : mode === 'in' ? (existing ? L('Edit deposit', 'تعديل الإيداع') : L('Add money', 'إضافة مبلغ'))
    : L('Move between my accounts', 'تحويل بين حساباتي');

  return (
    <Sheet lang={lang} onClose={onClose} title={title} sub={acc ? `${acc.name} · ${L('Balance', 'الرصيد')} ${fmtTotal(bal)} ${acc.currency}` : undefined}>
      {accounts.length > 1 && (
        <Field label={mode === 'in' ? L('Into account', 'إلى حساب') : L('From account', 'من حساب')}>
          <ModernSelect className="bk-select" value={accountId} onChange={e => setAccountId(e.target.value)}>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.name} · {a.currency}</option>)}
          </ModernSelect>
        </Field>
      )}
      {mode === 'move' && (
        <Field label={L('To account', 'إلى حساب')}>
          {others.length === 0
            ? <p className="bk-hint">{L('Add a second account in the same currency first.', 'أضف حساباً آخر بنفس العملة أولاً.')}</p>
            : (
              <ModernSelect className="bk-select" value={toId} onChange={e => setToId(e.target.value)}>
                {others.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </ModernSelect>
            )}
        </Field>
      )}
      {mode === 'out' && (
        <Field label={L('Sent to', 'المستفيد')}>
          <input autoFocus={!existing} value={payee} onChange={e => setPayee(e.target.value)} placeholder={L('e.g. Supplier 1', 'مثال: المورد 1')} />
          {suggestions.length > 0 && (
            <div className="bk-sugg">
              {suggestions.map(p => <button key={p} type="button" onClick={() => setPayee(p)}><Users />{p}</button>)}
            </div>
          )}
        </Field>
      )}
      <Field label={`${L('Amount', 'المبلغ')}${acc ? ` (${acc.currency})` : ''}`}>
        <input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0" autoFocus={mode !== 'out' && !existing} />
      </Field>
      {amt > 0 && acc && (
        <p className={cn('bk-after', after < 0 && 'neg')}>
          {L('Balance after', 'الرصيد بعد العملية')}: <b><bdi dir="ltr">{fmtTotal(after)} {acc.currency}</bdi></b>
          {after < 0 && ` · ${L('more than the balance', 'أكبر من الرصيد')}`}
        </p>
      )}
      <Field label={L('Date', 'التاريخ')}>
        <QuickDateField value={date} onChange={setDate} lang={lang} />
      </Field>
      <Field label={L('Note (optional)', 'ملاحظة (اختياري)')}>
        <input value={note} onChange={e => setNote(e.target.value)} placeholder={L('Invoice, reason…', 'فاتورة، سبب…')} />
      </Field>
      {err && <p className="bk-err">{err}</p>}
      <div className="bk-btns">
        <button type="button" className="bk-btn ghost" onClick={onClose}>{L('Cancel', 'إلغاء')}</button>
        <button type="button" className={cn('bk-btn', mode === 'out' && 'out', mode === 'in' && 'in')} onClick={submit} disabled={saving}>
          {saving ? <Loader2 className="animate-spin" /> : mode === 'out' ? <Send /> : mode === 'in' ? <Plus /> : <ArrowLeftRight />}
          {mode === 'out' ? L('Record transfer', 'تسجيل التحويل') : mode === 'in' ? L('Add', 'إضافة') : L('Move', 'تحويل')}
        </button>
      </div>
    </Sheet>
  );
}

// ─── Move an order to another account ────────────────────────────

function MoveOrderSheet({ move, accounts, onClose, lang, L, onSave, saving }: {
  move: BankMove; accounts: BankAccount[]; onClose: () => void; lang: Lang; L: Tr; saving: boolean; onSave: (accountId: string) => void;
}) {
  const pool = accounts.filter(a => a.currency === move.currency);
  const [pick, setPick] = useState(move.accountId);
  return (
    <Sheet lang={lang} onClose={onClose} title={L('Which account received this order?', 'أي حساب استلم هذا الطلب؟')} sub={`${fmtTotal(move.amount)} ${move.currency}`}>
      <div className="bk-picks">
        {pool.map(a => (
          <button key={a.id} type="button" className={cn('bk-pick', pick === a.id && 'on')} onClick={() => setPick(a.id)}>
            <Landmark /><span>{a.name}</span>{pick === a.id && <Check />}
          </button>
        ))}
      </div>
      <div className="bk-btns">
        <button type="button" className="bk-btn ghost" onClick={onClose}>{L('Cancel', 'إلغاء')}</button>
        <button type="button" className="bk-btn" disabled={saving || pick === move.accountId} onClick={() => onSave(pick)}>
          {saving ? <Loader2 className="animate-spin" /> : <Check />}{L('Save', 'حفظ')}
        </button>
      </div>
    </Sheet>
  );
}

// ─── Import a bank's transfer history ────────────────────────────

function ImportSheet({ file, plan, account, newBeneficiaries, onClose, lang, L, onConfirm, saving }: {
  file: BankImportFile; plan: ImportPlan; account: BankAccount; newBeneficiaries: number;
  onClose: () => void; lang: Lang; L: Tr; onConfirm: () => void; saving: boolean;
}) {
  const fmtAt = (at: string) => at.replace('T', ' ');
  return (
    <Sheet lang={lang} onClose={onClose} title={L('Import bank transfers', 'استيراد تحويلات البنك')} sub={`${file.bank ?? ''} → ${account.name}`}>
      <div className="bk-imp">
        <div><span>{L('Transfers to add', 'تحويلات ستُضاف')}</span><b>{plan.rows.length}</b></div>
        <div><span>{L('Total sent', 'إجمالي المحوَّل')}</span><b><bdi dir="ltr">{fmtTotal(plan.total)} {account.currency}</bdi></b></div>
        {plan.first && <div><span>{L('Period', 'الفترة')}</span><b><bdi dir="ltr">{plan.first.slice(0, 10)} → {plan.last?.slice(0, 10)}</bdi></b></div>}
        {plan.alreadyImported > 0 && <div><span>{L('Already imported (left as is)', 'مستوردة سابقاً (لن تتكرر)')}</span><b>{plan.alreadyImported}</b></div>}
        <div><span>{L('New beneficiaries', 'مستفيدون جدد')}</span><b>{newBeneficiaries}</b></div>
      </div>
      {plan.skipped.length > 0 && (
        <div className="bk-imp-skip">
          <b>{L('Not imported — did not go through', 'لن تُستورد — لم تكتمل')}</b>
          {plan.skipped.map((t, i) => (
            <span key={i}>{t.payee} · <bdi dir="ltr">{fmtTotal(t.amount)}</bdi> · <bdi dir="ltr">{fmtAt(t.at)}</bdi> · {t.status.replace(/_/g, ' ')}</span>
          ))}
        </div>
      )}
      <p className="bk-hint">{L('Only completed transfers are added. Importing the same file again adds nothing.', 'تُضاف التحويلات المكتملة فقط. استيراد نفس الملف مرة أخرى لا يضيف شيئاً.')}</p>
      <div className="bk-btns">
        <button type="button" className="bk-btn ghost" onClick={onClose}>{L('Cancel', 'إلغاء')}</button>
        <button type="button" className="bk-btn" onClick={onConfirm} disabled={saving || (plan.rows.length === 0 && newBeneficiaries === 0)}>
          {saving ? <Loader2 className="animate-spin" /> : <FileUp />}{L('Import', 'استيراد')}
        </button>
      </div>
    </Sheet>
  );
}

// ─── The tab ──────────────────────────────────────────────────────

export function CustomerBanksTab({ accounts, ledger, lang }: { accounts: BankAccount[]; ledger: BankLedgerRow[]; lang: Lang }) {
  const { userId } = useAuth();
  const qc = useQueryClient();
  const L: Tr = (en, ar) => (lang === 'ar' ? ar : en);
  const locale = lang === 'ar' ? 'ar-EG' : 'en-US';

  // Same cached statement fetch as the Orders page, so both list the same orders.
  const { data: statements = [], isLoading: ordersLoading } = useQuery({
    ...statementQueryOptions<PublicStatement>('sales', userId),
  });

  const active = useMemo(() => activeAccounts(accounts), [accounts]);
  const orders = useMemo(() => merchantOrdersFromStatements(statements as any), [statements]);
  const allMoves = useMemo(() => buildBankMoves(accounts, ledger, orders), [accounts, ledger, orders]);
  const balances = useMemo(() => accountBalances(allMoves), [allMoves]);
  const running = useMemo(() => runningBalances(allMoves), [allMoves]);
  const accById = useMemo(() => new Map(active.map(a => [a.id, a])), [active]);
  // Saved beneficiaries first (as the bank lists them), then anyone else already paid.
  const beneficiaries = useMemo(() => active.reduce((acc, a) => mergeBeneficiaries(acc, readBeneficiaries(a.notes)), [] as ReturnType<typeof readBeneficiaries>), [active]);
  const payeeNames = useMemo(() => {
    const used = knownPayees(allMoves);
    const seen = new Set(used.map(payeeKey));
    return [...used, ...beneficiaries.map(b => b.name).filter(n => !seen.has(payeeKey(n)))];
  }, [allMoves, beneficiaries]);

  const currencies = useMemo(() => [...new Set(active.map(a => a.currency))], [active]);
  const [selected, setSelected] = useState<string>('all');
  const [currency, setCurrency] = useState<string>('EGP');
  useEffect(() => {
    if (selected !== 'all' && !accById.has(selected)) setSelected('all');
    if (currencies.length && !currencies.includes(currency)) setCurrency(currencies.includes('EGP') ? 'EGP' : currencies[0]);
  }, [accById, currencies, selected, currency]);
  const selAcc = selected === 'all' ? null : accById.get(selected) ?? null;
  const viewCurrency = selAcc?.currency ?? currency;

  const scopedMoves = useMemo(
    () => allMoves.filter(m => (selAcc ? m.accountId === selAcc.id : m.currency === viewCurrency)),
    [allMoves, selAcc, viewCurrency],
  );

  const months = useMemo(() => {
    const set = new Set(scopedMoves.filter(m => isIncome(m) || isSpending(m)).map(m => monthKeyOf(m.ts)));
    set.add(monthKeyOf(Date.now()));
    return [...set].sort().reverse();
  }, [scopedMoves]);
  // Opens on the whole history so the headline figures are never a single month's slice; months are one tap away.
  const [month, setMonth] = useState<string | null>(null);
  const summary = useMemo(() => summarizeMoves(scopedMoves, month), [scopedMoves, month]);
  const prevMonthKey = useMemo(() => {
    if (!month) return null;
    const [y, m] = month.split('-').map(Number);
    return monthKeyOf(new Date(y, m - 2, 15).getTime());
  }, [month]);
  const prevSummary = useMemo(() => (prevMonthKey ? summarizeMoves(scopedMoves, prevMonthKey) : null), [scopedMoves, prevMonthKey]);

  const [flow, setFlow] = useState<'all' | 'in' | 'out'>('all');
  const [payeeFilter, setPayeeFilter] = useState('');
  const [search, setSearch] = useState('');
  const [showAllPayees, setShowAllPayees] = useState(false);

  const listMoves = useMemo(() => {
    const q = search.trim().toLowerCase();
    return scopedMoves.filter(m => {
      if (month && monthKeyOf(m.ts) !== month) return false;
      if (flow === 'in' && m.direction !== 'in') return false;
      if (flow === 'out' && m.direction !== 'out') return false;
      if (payeeFilter) {
        if (!isSpending(m)) return false;
        if ((m.payee ? payeeKey(m.payee) : NO_PAYEE_KEY) !== payeeFilter) return false;
      }
      if (q) {
        const hay = [m.payee, m.note, m.orderNumber, accById.get(m.accountId)?.name, String(m.amount)].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [scopedMoves, month, flow, payeeFilter, search, accById]);

  const flowCounts = useMemo(() => {
    const inMonth = scopedMoves.filter(m => !month || monthKeyOf(m.ts) === month);
    return { all: inMonth.length, in: inMonth.filter(m => m.direction === 'in').length, out: inMonth.filter(m => m.direction === 'out').length };
  }, [scopedMoves, month]);

  const dayGroups = useMemo(() => {
    const groups: Array<{ day: string; moves: BankMove[]; in: number; out: number }> = [];
    for (const m of listMoves) {
      const d = dayKeyOf(m.ts);
      let g = groups[groups.length - 1];
      if (!g || g.day !== d) { g = { day: d, moves: [], in: 0, out: 0 }; groups.push(g); }
      g.moves.push(m);
      if (m.direction === 'in') g.in += m.amount; else g.out += m.amount;
    }
    return groups;
  }, [listMoves]);

  // ── labels ──
  const monthLabel = (key: string) => {
    const [y, m] = key.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString(locale, { month: 'short', year: '2-digit' });
  };
  const dayLabel = (key: string) => {
    const [y, m, d] = key.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    if (key === todayStr()) return L('Today', 'اليوم');
    if (key === dayKeyOf(Date.now() - 86400000)) return L('Yesterday', 'أمس');
    return date.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'short' });
  };
  const timeLabel = (ts: number) => new Date(ts).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  const moveTitle = (m: BankMove) => {
    switch (m.kind) {
      case 'order': return m.orderNumber ? `${L('Merchant order', 'طلب من التاجر')} · ${m.orderNumber}` : L('Merchant order', 'طلب من التاجر');
      case 'payout': return m.payee as string;
      case 'withdrawal': return L('Withdrawal', 'سحب');
      case 'deposit': return L('Money added', 'إيداع');
      case 'opening': return L('Opening balance', 'رصيد افتتاحي');
      case 'move_in': return `${L('From', 'من')} ${accById.get(m.contraAccountId ?? '')?.name ?? L('my account', 'حسابي')}`;
      case 'move_out': return `${L('To', 'إلى')} ${accById.get(m.contraAccountId ?? '')?.name ?? L('my account', 'حسابي')}`;
    }
  };
  const typeLabel = (t: string) => { const x = ACCOUNT_TYPES.find(a => a.value === t); return x ? (lang === 'ar' ? x.ar : x.en) : t; };
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const delta = (now: number, before: number | undefined) => {
    if (!before) return null;
    return Math.round(((now - before) / before) * 100);
  };

  // ── writes ──
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['customer-cash-ledger', userId] });
    qc.invalidateQueries({ queryKey: ['customer-cash-accounts', userId] });
    qc.invalidateQueries({ queryKey: ['customer-cash-accounts-for-user', userId] });
    qc.invalidateQueries({ queryKey: ['c-cash-accounts', userId] });
    qc.invalidateQueries({ queryKey: ['c-order-cash-links', userId] });
  };
  const db = supabase as any;

  const [accountSheet, setAccountSheet] = useState<{ existing: BankAccount | null } | null>(null);
  const [entrySheet, setEntrySheet] = useState<{ mode: EntryMode; existing: BankMove | null } | null>(null);
  const [moveOrder, setMoveOrder] = useState<BankMove | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmRemoveAcc, setConfirmRemoveAcc] = useState(false);
  const [importing, setImporting] = useState<{ file: BankImportFile; plan: ImportPlan; account: BankAccount; newBeneficiaries: number } | null>(null);
  const importInput = useRef<HTMLInputElement>(null);

  const readImportFile = async (f: File | undefined, account: BankAccount) => {
    if (!f) return;
    try {
      const file = parseBankImport(JSON.parse(await f.text()));
      const plan = planImport(file, account.id, account.currency, new Set(ledger.map(r => r.id)));
      const current = readBeneficiaries(account.notes);
      const newBeneficiaries = mergeBeneficiaries(current, file.beneficiaries).length - current.length;
      setImporting({ file, plan, account, newBeneficiaries });
    } catch (e: any) {
      toast.error(e?.message ?? String(e));
    } finally {
      if (importInput.current) importInput.current.value = '';
    }
  };

  const runImport = useMutation({
    mutationFn: async () => {
      if (!userId || !importing) throw new Error('Not signed in');
      const { plan, account, file } = importing;
      for (let i = 0; i < plan.rows.length; i += 100) {
        const chunk = plan.rows.slice(i, i + 100).map(r => ({ ...r, user_id: userId }));
        const { error } = await db.from('cash_ledger').upsert(chunk, { onConflict: 'id', ignoreDuplicates: true });
        if (error) throw error;
      }
      const merged = mergeBeneficiaries(readBeneficiaries(account.notes), file.beneficiaries);
      const { error } = await db.from('cash_accounts').update({ notes: writeBeneficiaries(account.notes, merged) }).eq('id', account.id).eq('user_id', userId);
      if (error) throw error;
      return plan.rows.length;
    },
    onSuccess: (n) => { toast.success(L(`${n} transfers imported`, `تم استيراد ${n} تحويل`)); setImporting(null); setMonth(null); invalidate(); },
    onError: (e: any) => toast.error(e?.message ?? String(e)),
  });

  const saveAccount = useMutation({
    mutationFn: async (v: { name: string; type: string; currency: string; opening: number; startTs: number }) => {
      if (!userId) throw new Error('Not signed in');
      const existing = accountSheet?.existing;
      if (existing) {
        const { error } = await db.from('cash_accounts').update({ name: v.name, type: v.type, last_reconciled: v.startTs }).eq('id', existing.id).eq('user_id', userId);
        if (error) throw error;
        return existing.id;
      }
      const id = newId();
      const now = Date.now();
      const { error } = await db.from('cash_accounts').insert({ id, user_id: userId, name: v.name, type: v.type, currency: v.currency, status: 'active', created_at: now, last_reconciled: v.startTs });
      if (error) throw error;
      if (v.opening > 0) {
        const { error: e2 } = await db.from('cash_ledger').insert({
          id: newId(), user_id: userId, account_id: id, ts: now, type: 'opening', direction: 'in', amount: v.opening, currency: v.currency,
          note: null, contra_account_id: null, linked_entity_id: null, linked_entity_type: null,
        });
        if (e2) throw e2;
      }
      return id;
    },
    onSuccess: (id) => { toast.success(L('Account saved', 'تم حفظ الحساب')); setAccountSheet(null); setSelected(id); invalidate(); },
    onError: (e: any) => toast.error(e?.message ?? String(e)),
  });

  const removeAccount = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.from('cash_accounts').update({ status: 'inactive' }).eq('id', id).eq('user_id', userId);
      if (error) throw error;
    },
    onSuccess: () => { toast.success(L('Account removed', 'تم حذف الحساب')); setSelected('all'); setConfirmRemoveAcc(false); invalidate(); },
    onError: (e: any) => toast.error(e?.message ?? String(e)),
  });

  const saveEntry = useMutation({
    mutationFn: async (v: { accountId: string; toAccountId: string | null; amount: number; ts: number; payee: string | null; note: string | null }) => {
      if (!userId) throw new Error('Not signed in');
      const mode = entrySheet?.mode ?? 'out';
      const existing = entrySheet?.existing ?? null;
      const acc = accById.get(v.accountId);
      if (!acc) throw new Error('Unknown account');
      if (mode === 'move') {
        const base = newId();
        const common = { user_id: userId, ts: v.ts, amount: v.amount, currency: acc.currency, note: v.note, linked_entity_id: null, linked_entity_type: null };
        const { error } = await db.from('cash_ledger').insert([
          { ...common, id: `${base}-o`, account_id: v.accountId, contra_account_id: v.toAccountId, type: 'transfer_out', direction: 'out' },
          { ...common, id: `${base}-i`, account_id: v.toAccountId, contra_account_id: v.accountId, type: 'transfer_in', direction: 'in' },
        ]);
        if (error) throw error;
        return;
      }
      const rowData = {
        account_id: v.accountId, ts: v.ts, amount: v.amount, currency: acc.currency,
        type: mode === 'out' ? 'withdrawal' : 'deposit', direction: mode === 'out' ? 'out' : 'in',
        note: encodePayeeNote(v.payee, v.note),
      };
      if (existing?.ledgerId) {
        const { error } = await db.from('cash_ledger').update(rowData).eq('id', existing.ledgerId).eq('user_id', userId);
        if (error) throw error;
      } else {
        const { error } = await db.from('cash_ledger').insert({ id: newId(), user_id: userId, contra_account_id: null, linked_entity_id: null, linked_entity_type: null, ...rowData });
        if (error) throw error;
      }
    },
    onSuccess: () => { toast.success(L('Saved', 'تم الحفظ')); setEntrySheet(null); invalidate(); },
    onError: (e: any) => toast.error(e?.message ?? String(e)),
  });

  const deleteEntry = useMutation({
    mutationFn: async (m: BankMove) => {
      if (!m.ledgerId) return;
      const ids = [m.ledgerId];
      // A move between own accounts is two rows; both go together.
      if (m.kind === 'move_in' || m.kind === 'move_out') {
        const pair = m.ledgerId.replace(/-(o|i)$/, (_s, side) => (side === 'o' ? '-i' : '-o'));
        if (pair !== m.ledgerId) ids.push(pair);
      }
      const { error } = await db.from('cash_ledger').delete().in('id', ids).eq('user_id', userId);
      if (error) throw error;
    },
    onSuccess: () => { toast.success(L('Removed', 'تم الحذف')); setConfirmDelete(null); invalidate(); },
    onError: (e: any) => toast.error(e?.message ?? String(e)),
  });

  const routeOrder = useMutation({
    mutationFn: async ({ move, accountId }: { move: BankMove; accountId: string }) => {
      if (!userId || !move.orderKey) throw new Error('Missing order');
      if (move.ledgerId) {
        const { error } = await db.from('cash_ledger').update({ account_id: accountId }).eq('id', move.ledgerId).eq('user_id', userId);
        if (error) throw error;
        return;
      }
      const { error } = await db.from('cash_ledger').insert({
        id: newId(), user_id: userId, account_id: accountId, ts: move.ts, type: 'order_receipt', direction: 'in', amount: move.amount,
        currency: move.currency, note: move.orderNumber ?? null, contra_account_id: null,
        linked_entity_id: orderLinkId(move.orderKey), linked_entity_type: 'customer_order',
      });
      if (error) throw error;
    },
    onSuccess: () => { toast.success(L('Order moved', 'تم نقل الطلب')); setMoveOrder(null); invalidate(); },
    onError: (e: any) => toast.error(e?.message ?? String(e)),
  });

  // ── derived figures for the view ──
  const totalBalance = selAcc ? balances.get(selAcc.id) ?? 0 : active.filter(a => a.currency === viewCurrency).reduce((s, a) => s + (balances.get(a.id) ?? 0), 0);
  const defaultAccountId = selAcc?.id ?? primaryAccountId(viewCurrency, accounts);
  const topPayee = summary.payees.find(p => p.key !== NO_PAYEE_KEY) ?? null;
  const visiblePayees = showAllPayees ? summary.payees : summary.payees.slice(0, 5);
  const seriesMax = Math.max(1, ...summary.series.map(s => Math.max(s.in, s.out)));
  const outDelta = delta(summary.moneyOut, prevSummary?.moneyOut);
  const inDelta = delta(summary.moneyIn, prevSummary?.moneyIn);

  if (active.length === 0) {
    return (
      <>
        <div className="co-mainwrap">
          <div className="ch-card co-main bk-welcome">
            <span className="bk-welcome-ic"><Landmark /></span>
            <b>{L('Track your bank accounts', 'تابع حساباتك البنكية')}</b>
            <p>{L('Add the bank account your merchant transfers to. Every order lands there automatically, and you record where the money goes next.', 'أضف الحساب البنكي الذي يحوّل إليه التاجر. كل طلب يُودع فيه تلقائياً، وتسجّل أنت أين ذهبت الأموال بعد ذلك.')}</p>
            <button type="button" className="co-new" onClick={() => setAccountSheet({ existing: null })}><Plus strokeWidth={2.4} />{L('Add a bank account', 'إضافة حساب بنكي')}</button>
          </div>
        </div>
        {accountSheet && <AccountSheet existing={accountSheet.existing} lang={lang} L={L} onClose={() => setAccountSheet(null)} saving={saveAccount.isPending} onSave={v => saveAccount.mutate(v)} />}
      </>
    );
  }

  return (
    <>
      <div className="co-mainwrap">
        <div className="ch-card co-main">
          <div className="co-mtop">
            <div className="co-mlabel">{L('My bank accounts', 'حساباتي البنكية')}</div>
            <button type="button" className="co-new" onClick={() => setEntrySheet({ mode: 'out', existing: null })}>
              <Send strokeWidth={2.4} />{L('Send money', 'تحويل مبلغ')}
            </button>
          </div>

          {/* Accounts strip: the total first, then each account, then add. */}
          <div className="bk-accts">
            <button type="button" className={cn('bk-acct total', selected === 'all' && 'on')} onClick={() => setSelected('all')}>
              <span className="bk-acct-top"><Landmark /><span>{L('All accounts', 'كل الحسابات')}</span></span>
              <b><bdi dir="ltr">{fmtTotal(active.filter(a => a.currency === viewCurrency).reduce((s, a) => s + (balances.get(a.id) ?? 0), 0))}</bdi></b>
              <small>{viewCurrency} · {active.filter(a => a.currency === viewCurrency).length} {L('accounts', 'حسابات')}</small>
            </button>
            {active.map(a => {
              const isPrimary = primaryAccountId(a.currency, accounts) === a.id;
              return (
                <button key={a.id} type="button" className={cn('bk-acct', selected === a.id && 'on')} onClick={() => setSelected(a.id)}>
                  <span className="bk-acct-top"><Landmark /><span>{a.name}</span>{isPrimary && <Crown className="bk-crown" aria-label={L('Primary', 'رئيسي')} />}</span>
                  <b><bdi dir="ltr">{fmtTotal(balances.get(a.id) ?? 0)}</bdi></b>
                  <small>{a.currency} · {typeLabel(a.type)}</small>
                </button>
              );
            })}
            <button type="button" className="bk-acct add" onClick={() => setAccountSheet({ existing: null })}>
              <Plus /><span>{L('Add bank', 'إضافة بنك')}</span>
            </button>
          </div>

          {!selAcc && currencies.length > 1 && (
            <div className="bk-curs">
              {currencies.map(c => <button key={c} type="button" className={cn('co-chip', currency === c && 'on')} onClick={() => setCurrency(c)}>{c}</button>)}
            </div>
          )}

          {selAcc && (
            <div className="bk-acctbar">
              <span className="bk-acctbar-t">
                {primaryAccountId(selAcc.currency, accounts) === selAcc.id
                  ? <><Crown />{L('Primary — orders arrive here', 'رئيسي — تصل الطلبات هنا')}</>
                  : L('Orders go to your primary account; you can move any order here.', 'الطلبات تذهب لحسابك الرئيسي، ويمكنك نقل أي طلب هنا.')}
              </span>
              <span className="bk-acctbar-a">
                <button type="button" onClick={() => setEntrySheet({ mode: 'in', existing: null })}><Plus />{L('Add money', 'إيداع')}</button>
                {active.filter(a => a.currency === selAcc.currency).length > 1 && (
                  <button type="button" onClick={() => setEntrySheet({ mode: 'move', existing: null })}><ArrowLeftRight />{L('Move', 'تحويل داخلي')}</button>
                )}
                <button type="button" onClick={() => importInput.current?.click()}><FileUp />{L('Import', 'استيراد')}</button>
                <input ref={importInput} type="file" accept=".json,application/json" hidden onChange={e => readImportFile(e.target.files?.[0], selAcc)} />
                <button type="button" onClick={() => setAccountSheet({ existing: selAcc })} aria-label={L('Edit', 'تعديل')}><Edit2 /></button>
                {confirmRemoveAcc ? (
                  <>
                    <button type="button" className="danger" onClick={() => removeAccount.mutate(selAcc.id)}>{L('Remove', 'حذف')}</button>
                    <button type="button" onClick={() => setConfirmRemoveAcc(false)}>{L('Keep', 'إلغاء')}</button>
                  </>
                ) : (
                  <button type="button" onClick={() => setConfirmRemoveAcc(true)} aria-label={L('Remove', 'حذف')}><Trash2 /></button>
                )}
              </span>
            </div>
          )}

          {/* Months */}
          <div className="cw-months">
            <div className="co-months">
              {[{ key: null as string | null, label: L('All time', 'كل الفترات') }, ...months.map(m => ({ key: m as string | null, label: monthLabel(m) }))].map(m => (
                <button key={m.key ?? 'all'} type="button" className={cn('co-chip', month === m.key && 'on')} onClick={() => setMonth(m.key)}>{m.label}</button>
              ))}
            </div>
          </div>

          {/* In, out, balance */}
          <div className="cw-stats">
            <div className="cw-card cw-stat bk-in">
              <div className="cw-stat-l">{L('Money in', 'الوارد')}</div>
              <span className="cw-stat-ic"><ArrowDownLeft /></span>
              <div className="cw-stat-v"><bdi dir="ltr">{fmtTotal(summary.moneyIn)}</bdi></div>
              <div className="cw-stat-u">{inDelta === null ? `${summary.orderCount} ${L('orders', 'طلبات')}` : `${inDelta >= 0 ? '▲' : '▼'} ${Math.abs(inDelta)}% ${L('vs last month', 'عن الشهر الماضي')}`}</div>
            </div>
            <div className="cw-card cw-stat bk-out">
              <div className="cw-stat-l">{L('Money out', 'الصادر')}</div>
              <span className="cw-stat-ic"><ArrowUpRight /></span>
              <div className="cw-stat-v"><bdi dir="ltr">{fmtTotal(summary.moneyOut)}</bdi></div>
              <div className="cw-stat-u">{outDelta === null ? `${summary.transferCount} ${L('transfers', 'تحويلات')}` : `${outDelta >= 0 ? '▲' : '▼'} ${Math.abs(outDelta)}% ${L('vs last month', 'عن الشهر الماضي')}`}</div>
            </div>
            <div className="cw-card cw-stat bk-bal">
              <div className="cw-stat-l">{L('Balance now', 'الرصيد الآن')}</div>
              <span className="cw-stat-ic"><Landmark /></span>
              <div className="cw-stat-v"><bdi dir="ltr">{fmtTotal(totalBalance)}</bdi></div>
              <div className="cw-stat-u">({viewCurrency})</div>
            </div>
          </div>

          {/* How much of what came in has gone out */}
          <div className="bk-flow">
            <div className="bk-flow-t">
              <span>{L('Spent of what came in', 'المصروف من الوارد')}</span>
              <b className={cn(summary.net < 0 && 'neg')}>{L('Net', 'الصافي')} <bdi dir="ltr">{summary.net >= 0 ? '+' : '−'}{fmtTotal(Math.abs(summary.net))}</bdi></b>
            </div>
            <div className="bk-flow-track">
              <div style={{ width: `${Math.min(100, summary.spentPct)}%` }} />
            </div>
            <div className="bk-flow-l">
              <span className="o">{summary.moneyIn > 0 ? `${summary.spentPct}%` : '—'}</span>
              <span>{summary.orderCount} {L('orders received', 'طلبات مستلمة')} · <bdi dir="ltr">{fmtTotal(summary.orderIn)}</bdi></span>
            </div>
          </div>
        </div>
      </div>

      {/* Where the money went */}
      <section className="cw-card bk-sec">
        <div className="bk-sec-h">
          <span><Trophy />{L('Where your money went', 'أين ذهبت أموالك')}</span>
          {payeeFilter && <button type="button" onClick={() => setPayeeFilter('')}><X />{L('Clear', 'مسح')}</button>}
        </div>
        {summary.payees.length === 0 ? (
          <p className="bk-none">{L('No transfers yet in this period. Tap "Send money" each time you transfer from the bank.', 'لا توجد تحويلات في هذه الفترة. اضغط "تحويل مبلغ" في كل مرة تحوّل من البنك.')}</p>
        ) : (
          <>
            <div className="bk-stack" aria-hidden="true">
              {summary.payees.slice(0, 6).map((p, i) => (
                <div key={p.key} style={{ width: `${p.share * 100}%`, background: RANK_COLORS[Math.min(i, RANK_COLORS.length - 1)] }} />
              ))}
            </div>
            <ol className="bk-payees">
              {visiblePayees.map((p, i) => {
                const color = RANK_COLORS[Math.min(i, RANK_COLORS.length - 1)];
                return (
                  <li key={p.key}>
                    <button type="button" className={cn('bk-payee', payeeFilter === p.key && 'on')} onClick={() => { setPayeeFilter(payeeFilter === p.key ? '' : p.key); setFlow('all'); }}>
                      <span className="bk-rank" style={{ background: `${color}1a`, color }}>{i + 1}</span>
                      <span className="bk-payee-m">
                        <span className="bk-payee-n">{p.name ?? L('No name', 'بدون اسم')}</span>
                        <span className="bk-payee-s">{p.count} {L(p.count === 1 ? 'transfer' : 'transfers', 'تحويل')} · {L('avg', 'متوسط')} <bdi dir="ltr">{fmtTotal(p.average)}</bdi></span>
                        <span className="bk-payee-bar"><span style={{ width: `${p.share * 100}%`, background: color }} /></span>
                      </span>
                      <span className="bk-payee-v">
                        <b><bdi dir="ltr">{fmtTotal(p.total)}</bdi></b>
                        <small>{pct(p.share)}</small>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
            {summary.payees.length > 5 && (
              <button type="button" className="bk-more" onClick={() => setShowAllPayees(v => !v)}>
                {showAllPayees ? L('Show less', 'عرض أقل') : `${L('Show all', 'عرض الكل')} (${summary.payees.length})`}
                <ChevronDown className={cn(showAllPayees && 'up')} />
              </button>
            )}
          </>
        )}
      </section>

      {/* Highlights */}
      <div className="bk-kpis">
        <div className="cw-card bk-kpi k1">
          <span className="bk-kpi-ic"><Crown /></span>
          <span className="bk-kpi-l">{L('Paid the most', 'الأكثر استلاماً')}</span>
          <b className="bk-kpi-v">{topPayee?.name ?? '—'}</b>
          <small>{topPayee ? <><bdi dir="ltr">{fmtTotal(topPayee.total)}</bdi> · {pct(topPayee.share)}</> : L('No transfers', 'لا تحويلات')}</small>
        </div>
        <div className="cw-card bk-kpi k2">
          <span className="bk-kpi-ic"><Zap /></span>
          <span className="bk-kpi-l">{L('Largest transfer', 'أكبر تحويل')}</span>
          <b className="bk-kpi-v"><bdi dir="ltr">{summary.largest ? fmtTotal(summary.largest.amount) : '—'}</bdi></b>
          <small>{summary.largest ? (summary.largest.payee ?? L('Withdrawal', 'سحب')) : '—'}</small>
        </div>
        <div className="cw-card bk-kpi k3">
          <span className="bk-kpi-ic"><Users /></span>
          <span className="bk-kpi-l">{L('People paid', 'عدد المستفيدين')}</span>
          <b className="bk-kpi-v">{summary.payees.filter(p => p.key !== NO_PAYEE_KEY).length}</b>
          <small>{summary.transferCount} {L('transfers', 'تحويلات')} · {L('avg', 'متوسط')} <bdi dir="ltr">{fmtTotal(summary.transferCount ? summary.moneyOut / summary.transferCount : 0)}</bdi></small>
        </div>
        <div className="cw-card bk-kpi k4">
          <span className="bk-kpi-ic"><CalendarDays /></span>
          <span className="bk-kpi-l">{L('Busiest day', 'أكثر يوم صرفاً')}</span>
          <b className="bk-kpi-v">{summary.busiestDay ? dayLabel(summary.busiestDay.day) : '—'}</b>
          <small>{summary.busiestDay ? <bdi dir="ltr">{fmtTotal(summary.busiestDay.total)}</bdi> : '—'}</small>
        </div>
      </div>

      {/* In and out over time */}
      {summary.series.length > 0 && (
        <section className="cw-card bk-sec">
          <div className="bk-sec-h">
            <span><BarChart3 />{month ? L('Daily in & out', 'الوارد والصادر يومياً') : L('Monthly in & out', 'الوارد والصادر شهرياً')}</span>
            <span className="bk-legend"><i className="in" />{L('In', 'وارد')}<i className="out" />{L('Out', 'صادر')}</span>
          </div>
          <div className="bk-chart" role="img" aria-label={L('In and out chart', 'مخطط الوارد والصادر')}>
            {summary.series.map(s => (
              <div key={s.key} className="bk-col" title={`${s.key}: +${fmtTotal(s.in)} / −${fmtTotal(s.out)}`}>
                <div className="bk-bars">
                  <span className="in" style={{ height: `${(s.in / seriesMax) * 100}%` }} />
                  <span className="out" style={{ height: `${(s.out / seriesMax) * 100}%` }} />
                </div>
                <small>{month ? Number(s.key.slice(8)) : monthLabel(s.key)}</small>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Activity */}
      <div className="cw-card cw-chips">
        {([
          { key: 'all', cls: 'all', label: L('All', 'الكل'), icon: <ArrowLeftRight />, n: flowCounts.all },
          { key: 'in', cls: 'done', label: L('In', 'وارد'), icon: <ArrowDownLeft />, n: flowCounts.in },
          { key: 'out', cls: 'wait', label: L('Out', 'صادر'), icon: <ArrowUpRight />, n: flowCounts.out },
        ] as const).map(c => (
          <button key={c.key} type="button" className={cn('cw-chip', c.cls, flow === c.key && 'on')} onClick={() => setFlow(c.key)}>
            <span className="cw-chip-ic">{c.icon}</span>
            <span className="cw-chip-l">{c.label}</span>
            <span className="cw-chip-n">{c.n}</span>
          </button>
        ))}
      </div>

      <label className="cw-search bk-search">
        <Search />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder={L('Search by name, note or amount…', 'ابحث بالاسم أو الملاحظة أو المبلغ…')} />
      </label>

      {payeeFilter && (
        <div className="cw-fbar" role="status">
          <Users className="cw-fbar-ic" />
          <div className="cw-fbar-t">
            <span>{L('Transfers to', 'التحويلات إلى')} <b>{summary.payees.find(p => p.key === payeeFilter)?.name ?? L('No name', 'بدون اسم')}</b></span>
            <span className="cw-fbar-sum">{L('Total', 'الإجمالي')}: <b><bdi dir="ltr">{fmtTotal(listMoves.reduce((s, m) => s + m.amount, 0))}</bdi></b> {viewCurrency}</span>
          </div>
          <button type="button" className="cw-fbar-clear" onClick={() => setPayeeFilter('')}><X />{L('Clear', 'مسح')}</button>
        </div>
      )}

      {ordersLoading && allMoves.length === 0 ? (
        <div className="cw-loading"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : dayGroups.length === 0 ? (
        <div className="cw-card cw-empty">{L('No movements in this period', 'لا توجد حركات في هذه الفترة')}</div>
      ) : (
        <div className="bk-days">
          {dayGroups.map(g => (
            <div key={g.day} className="bk-day">
              <div className="bk-day-h">
                <span>{dayLabel(g.day)}</span>
                <span className="bk-day-s">
                  {g.in > 0 && <i className="in"><bdi dir="ltr">+{fmtTotal(g.in)}</bdi></i>}
                  {g.out > 0 && <i className="out"><bdi dir="ltr">−{fmtTotal(g.out)}</bdi></i>}
                </span>
              </div>
              <div className="cw-list">
                {g.moves.map(m => {
                  const isIn = m.direction === 'in';
                  const internal = m.kind === 'move_in' || m.kind === 'move_out';
                  const accent = internal ? '#64748b' : isIn ? '#16a34a' : '#e11d48';
                  const editable = !!m.ledgerId && (m.kind === 'payout' || m.kind === 'withdrawal' || m.kind === 'deposit');
                  const deletable = !!m.ledgerId && m.kind !== 'order';
                  const movable = m.kind === 'order' && active.filter(a => a.currency === m.currency).length > 1;
                  const accName = accById.get(m.accountId)?.name;
                  return (
                    <div key={m.id} className="cw-card cw-row bk-row" style={{ ['--acc' as string]: accent }}>
                      <div className="bk-row-in">
                        <span className={cn('bk-row-ic', internal ? 'mv' : isIn ? 'in' : 'out')}>
                          {internal ? <ArrowLeftRight /> : isIn ? <ArrowDownLeft /> : <ArrowUpRight />}
                        </span>
                        <span className="bk-row-m">
                          <b>{moveTitle(m)}</b>
                          <small>
                            {timeLabel(m.ts)}
                            {!selAcc && accName ? ` · ${accName}` : ''}
                            {m.kind === 'order' && !m.ledgerId ? ` · ${L('auto', 'تلقائي')}` : ''}
                            {m.note ? ` · ${m.note}` : ''}
                          </small>
                        </span>
                        <span className="bk-row-v">
                          <b style={{ color: accent }}><bdi dir="ltr">{isIn ? '+' : '−'}{fmtTotal(m.amount)}</bdi></b>
                          {selAcc && <small><bdi dir="ltr">{fmtTotal(running.get(m.id) ?? 0)}</bdi></small>}
                        </span>
                      </div>
                      {(editable || deletable || movable) && (
                        <div className="bk-row-a">
                          {confirmDelete === m.id ? (
                            <>
                              <span className="cw-act ask">{L('Remove this entry?', 'حذف هذه الحركة؟')}</span>
                              <button type="button" className="cw-mini danger" onClick={() => deleteEntry.mutate(m)} disabled={deleteEntry.isPending}>{L('Remove', 'حذف')}</button>
                              <button type="button" className="cw-mini" onClick={() => setConfirmDelete(null)}>{L('Cancel', 'إلغاء')}</button>
                            </>
                          ) : (
                            <>
                              {movable && <button type="button" className="cw-act" onClick={() => setMoveOrder(m)}><Landmark />{L('Change account', 'تغيير الحساب')}</button>}
                              {editable && <button type="button" className="cw-act" onClick={() => setEntrySheet({ mode: m.direction === 'out' ? 'out' : 'in', existing: m })}><Edit2 />{L('Edit', 'تعديل')}</button>}
                              {deletable && <button type="button" className="cw-act" onClick={() => setConfirmDelete(m.id)}><Trash2 />{L('Delete', 'حذف')}</button>}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {accountSheet && <AccountSheet existing={accountSheet.existing} lang={lang} L={L} onClose={() => setAccountSheet(null)} saving={saveAccount.isPending} onSave={v => saveAccount.mutate(v)} />}
      {entrySheet && (
        <EntrySheet
          mode={entrySheet.mode} existing={entrySheet.existing} lang={lang} L={L}
          accounts={entrySheet.mode === 'move' && selAcc ? active.filter(a => a.currency === selAcc.currency) : active}
          balances={balances} defaultAccountId={defaultAccountId} payees={payeeNames}
          onClose={() => setEntrySheet(null)} saving={saveEntry.isPending} onSave={v => saveEntry.mutate(v)}
        />
      )}
      {importing && (
        <ImportSheet {...importing} lang={lang} L={L} onClose={() => setImporting(null)} saving={runImport.isPending} onConfirm={() => runImport.mutate()} />
      )}
      {moveOrder && (
        <MoveOrderSheet move={moveOrder} accounts={active} lang={lang} L={L} onClose={() => setMoveOrder(null)} saving={routeOrder.isPending}
          onSave={accountId => routeOrder.mutate({ move: moveOrder, accountId })} />
      )}
    </>
  );
}

