import { useId, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowDown, ArrowLeftRight, ArrowUp, Banknote, BookOpen, CalendarDays, ChevronRight, CirclePlus, ClipboardList, Clock3, Coins, FileText, Filter, HandCoins, Landmark, LayoutGrid, List, MoreHorizontal, MoreVertical, PieChart, Plus, Scale, Search, Settings, ShieldCheck, Wallet, type LucideIcon } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useT } from '@/lib/i18n';
import { fmtTotal, type CashAccount, type CashAccountType, type TrackerState } from '@/lib/tracker-helpers';
import { csvCell, downloadTextFile } from '@/features/stock/utils/loanStatementExport';
import { useNetPositionSettings, usePersonalLoans } from '@/features/net-position/api';
import { computePosition } from '@/features/net-position/position';
import { useExchangeBalances } from '@/features/exchanges/hooks/useExchangeBalances';
import { buildCashOverview } from './cash-overview-model';
import '@/styles/cash-overview.css';

export type CashSection = 'accounts' | 'flow' | 'loans' | 'position' | 'statements';
export type CashAccountAction = 'ledger' | 'deposit' | 'withdrawal' | 'transfer' | 'notes' | 'edit' | 'clear' | 'delete' | 'funding' | 'proceeds' | 'settlement';
interface Props {
  state: TrackerState;
  section: CashSection;
  onSection: (section: CashSection) => void;
  onAddAccount: () => void;
  onAddCash: () => void;
  onTransfer: () => void;
  onCustody: () => void;
  onAccountAction: (account: CashAccount, action: CashAccountAction) => void;
  loaded: boolean;
  now?: number;
}
const TYPE_ICONS: Record<CashAccountType, LucideIcon> = { hand: Wallet, bank: Landmark, vault: ShieldCheck, merchant_custody: HandCoins };
const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${fmtTotal(Math.abs(n))}`;
const clean = (s: string) => s.replace(/^[^\p{L}\p{N}]+\s*/u, '');

function Trend({ values, bars = false }: { values: number[]; bars?: boolean }) {
  const id = useId().replace(/:/g, '');
  const low = Math.min(...values, 0), high = Math.max(...values, 1), span = high - low || 1;
  const points = values.map((n, i) => `${i * 100 / Math.max(1, values.length - 1)},${39 - (n - low) / span * 35}`).join(' ');
  return <svg viewBox="0 0 100 42" className="cm-spark" aria-hidden="true" preserveAspectRatio="none"><defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="currentColor" stopOpacity=".75" /><stop offset="1" stopColor="currentColor" stopOpacity=".04" /></linearGradient></defs>{bars ? values.map((n, i) => <rect key={i} x={i * 10 + 2} y={39 - (n - low) / span * 35} width="6" height={Math.max(1, (n - low) / span * 35)} rx="2" fill={`url(#${id})`} />) : <><polygon points={`0,42 ${points} 100,42`} fill={`url(#${id})`} /><polyline points={points} stroke="currentColor" fill="none" strokeWidth="2" strokeLinejoin="round" /></>}</svg>;
}
function Badge({ icon: Icon }: { icon: LucideIcon }) { return <span className="cm-icon"><Icon size={17} strokeWidth={2} /></span>; }

function NetPosition({ state, onOpen }: { state: TrackerState; onOpen: () => void }) {
  const t = useT();
  const { settings, loaded, unavailable } = useNetPositionSettings();
  const { loans, loaded: loansLoaded, unavailable: loansUnavailable } = usePersonalLoans();
  const exchange = useExchangeBalances();
  const position = useMemo(() => {
    if (!loaded || !loansLoaded || !exchange.isSuccess || unavailable || loansUnavailable) return null;
    const sums = { binance: 0, okx: 0 };
    for (const b of exchange.data || []) if (b.asset === 'USDT') sums[b.exchange] += b.free + b.locked;
    return computePosition({ accounts: state.cashAccounts || [], ledger: state.cashLedger || [], includedAccountIds: new Set(settings?.includedAccounts || []), customerLoans: state.customerLoans || [], deletedLoanIds: state.deletedLoanIds, customerName: id => id, personalLoans: loans, exchange: sums, batches: state.batches || [], trades: state.trades || [], usdtTransfers: state.usdtTransfers, usdRateOverride: settings?.usdRate, egpRateOverride: settings?.egpRate });
  }, [state, settings, loaded, unavailable, loans, loansLoaded, loansUnavailable, exchange.data, exchange.isSuccess]);
  return <button className="cm-net" type="button" onClick={onOpen}><Badge icon={Scale} /><span><small>{t('cmNetPosition')}</small><strong className={position && position.netQAR < 0 ? 'cm-bad' : 'cm-good'}>{position ? signed(position.netQAR) : '—'} <em>QAR</em></strong></span><ChevronRight size={15} /></button>;
}

export function CashOverview({ state, section, onSection, onAddAccount, onAddCash, onTransfer, onCustody, onAccountAction, loaded, now = Date.now() }: Props) {
  const t = useT(); const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'cards' | 'list'>('cards');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [type, setType] = useState('all'), [currency, setCurrency] = useState('all'), [status, setStatus] = useState('all');
  const data = useMemo(() => buildCashOverview(state, now), [state, now]);
  const typeLabels: Record<CashAccountType, string> = { hand: t('inHandLbl'), bank: t('banksLbl'), vault: t('vaultLbl'), merchant_custody: t('kpiCustody') };
  const visible = data.rows.filter(({ account: a }) => (!query.trim() || [a.name, a.bankName, a.branch, a.currency].filter(Boolean).join(' ').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) && (type === 'all' || a.type === type) && (currency === 'all' || a.currency === currency) && (status === 'all' || a.status === status));
  const hasFilters = type !== 'all' || currency !== 'all' || status !== 'all';
  const change = (n: number | null) => n === null ? '—' : `${n > 0 ? '+' : ''}${Math.round(n)}%`;
  const tabs: { id: CashSection; label: string; Icon: LucideIcon }[] = [
    { id: 'accounts', label: clean(t('cashAccountsTab')), Icon: Landmark }, { id: 'flow', label: clean(t('cashFlowTab')), Icon: ArrowLeftRight }, { id: 'loans', label: clean(t('cashLoansTab')), Icon: HandCoins }, { id: 'position', label: clean(t('cashPositionTab')), Icon: Scale }, { id: 'statements', label: clean(t('cashStatementsTab')), Icon: FileText },
  ];
  const kpis = [
    { key: 'total', label: t('totalCashLbl'), Icon: Wallet, tone: 'brand', ...data.total, currency: 'QAR' },
    { key: 'hand', label: t('inHandLbl'), Icon: Coins, tone: 'blue', ...data.hand, currency: 'QAR' },
    { key: 'bank', label: t('banksLbl'), Icon: Landmark, tone: 'purple', ...data.banks, currency: 'QAR' },
    { key: 'loans', label: t('kpiLoansOut'), Icon: ArrowDown, tone: 'red', balance: data.loan.remaining, change: data.loan.change, trend: data.loan.trend, currency: data.loan.currency },
  ];
  const exportStatement = (account: CashAccount) => {
    const entries = (state.cashLedger || []).filter(e => e.accountId === account.id).sort((a, b) => a.ts - b.ts);
    let balance = 0;
    const csv = [[t('time'), t('type'), t('note'), t('currency'), t('amount'), t('cv2Balance')].map(csvCell).join(','), ...entries.map(e => { const amount = e.direction === 'in' ? e.amount : -e.amount; balance += amount; return [new Date(e.ts).toISOString(), e.type, e.note || '', account.currency, amount, Number(balance.toFixed(2))].map(csvCell).join(','); })].join('\r\n');
    downloadTextFile(`account-${account.id}-${new Date(now).toISOString().slice(0, 10)}.csv`, csv);
  };
  const menu = (account: CashAccount, horizontal = false) => <DropdownMenu><DropdownMenuTrigger asChild><button type="button" className="cm-menu-button" aria-label={`${t('cmMore')} · ${account.name}`}>{horizontal ? <MoreHorizontal size={17} /> : <MoreVertical size={17} />}</button></DropdownMenuTrigger><DropdownMenuContent align="end">{account.status === 'active' && <><DropdownMenuItem onSelect={() => onAccountAction(account, account.type === 'merchant_custody' ? 'funding' : 'deposit')}>{t('cmAddCash')}</DropdownMenuItem><DropdownMenuItem onSelect={() => onAccountAction(account, account.type === 'merchant_custody' ? 'proceeds' : 'withdrawal')}>{account.type === 'merchant_custody' ? t('saleProceeds') : t('withdrawTitle')}</DropdownMenuItem>{account.type === 'merchant_custody' && <DropdownMenuItem onSelect={() => onAccountAction(account, 'settlement')}>{t('settleBack')}</DropdownMenuItem>}<DropdownMenuItem onSelect={() => onAccountAction(account, 'transfer')}>{t('transferLbl')}</DropdownMenuItem><DropdownMenuItem onSelect={() => onAccountAction(account, 'notes')}>{t('notesDetailsBtn')}</DropdownMenuItem></>}<DropdownMenuItem onSelect={() => onAccountAction(account, 'edit')}>{t('edit')}</DropdownMenuItem><DropdownMenuItem onSelect={() => exportStatement(account)}>{t('cmStatement')}</DropdownMenuItem><DropdownMenuItem className="text-destructive" onSelect={() => onAccountAction(account, 'clear')}>{t('clearLedger')}</DropdownMenuItem><DropdownMenuItem className="text-destructive" onSelect={() => onAccountAction(account, 'delete')}>{t('deleteAccountBtn')}</DropdownMenuItem></DropdownMenuContent></DropdownMenu>;

  return <div className="cm-overview" dir={t.isRTL ? 'rtl' : 'ltr'}>
    <header className="cm-heading"><div><h1>{t('cashManagement')}</h1><p>{t('cmSubtitle')}</p></div><NetPosition state={state} onOpen={() => onSection('position')} /></header>
    <section className="cm-kpis" aria-label={t('cashManagement')}>{kpis.map(k => <button type="button" key={k.key} className={`cm-kpi cm-tone-${k.tone}`} onClick={() => onSection(k.key === 'loans' ? 'loans' : 'accounts')}><div className="cm-kpi-heading"><Badge icon={k.Icon} /><div><span>{k.label}</span><strong>{fmtTotal(k.balance)} <small>{k.currency}</small></strong></div></div><Trend values={k.trend} bars={k.key !== 'total'} /><p className={k.change !== null && k.change < 0 ? 'cm-bad' : 'cm-good'}>{k.change !== null && (k.change < 0 ? <ArrowDown size={11} /> : <ArrowUp size={11} />)}{change(k.change)} <span>{k.change === null ? t('cmNoBaseline') : t('cmLastMonth')}</span></p></button>)}</section>
    <section className="cm-repayments" aria-label={t('kpiLoansRepaid')}><div><span>{t('kpiLoansGiven')} <b>{fmtTotal(data.loan.given)} {data.loan.currency}</b></span><span>{t('kpiLoansRepaid')} <b>{fmtTotal(data.loan.repaid)} {data.loan.currency}</b> <em>({Math.round(data.loan.percent)}%)</em></span><span>{t('cmRemaining')} <b>{fmtTotal(data.loan.remaining)} {data.loan.currency}</b></span></div><div className="cm-progress" role="progressbar" aria-label={t('kpiLoansRepaid')} aria-valuenow={Math.round(data.loan.percent)} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${data.loan.percent}%` }} /></div>{data.otherLoans.map(l => <p key={l.currency}>{l.currency} · {t('kpiLoansGiven')} {fmtTotal(l.given)} · {t('kpiLoansRepaid')} {fmtTotal(l.repaid)} · {t('cmRemaining')} {fmtTotal(l.remaining)}</p>)}</section>
    <nav className="cm-tabs" aria-label={t('cashManagement')}>{tabs.map(({ id, label, Icon }) => <button key={id} type="button" className={section === id ? 'is-active' : ''} aria-current={section === id ? 'page' : undefined} onClick={() => onSection(id)}><Icon size={15} />{label}</button>)}<button type="button" onClick={() => navigate('/settings')}><Settings size={15} />{t('settings')}</button></nav>
    {section === 'accounts' && <>
      <div className="cm-actions"><button type="button" className="is-primary" onClick={onAddAccount}><Plus size={16} />{clean(t('addAccountBtn'))}</button><button type="button" onClick={onAddCash}><Banknote size={16} />{t('cmAddCash')}</button><button type="button" onClick={onTransfer} disabled={(state.cashAccounts || []).filter(a => a.status === 'active').length < 2}><ArrowLeftRight size={16} />{t('transferLbl')}</button><button type="button" onClick={onCustody}><ShieldCheck size={16} />{t('kpiCustody')}</button></div>
      <div className="cm-accounts-toolbar"><h2>{clean(t('cashAccountsTab'))} ({data.rows.length})</h2><div className="cm-view-toggle"><button type="button" aria-pressed={view === 'cards'} onClick={() => setView('cards')}><LayoutGrid size={14} />{t('cmCards')}</button><button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')}><List size={14} />{t('cmList')}</button></div><label className="cm-search"><Search size={15} /><input data-update-passive type="search" value={query} onChange={e => setQuery(e.target.value)} aria-label={t('cmSearch')} placeholder={t('cmSearch')} /></label><button type="button" className={`cm-filter ${hasFilters ? 'is-active' : ''}`} onClick={() => setFiltersOpen(v => !v)} aria-expanded={filtersOpen} aria-label={t('cmFilter')}><Filter size={16} /></button></div>
      {filtersOpen && <div className="cm-filters"><label>{t('cmAccountType')}<select data-update-passive value={type} onChange={e => setType(e.target.value)}><option value="all">{t('cmAllTypes')}</option>{Object.entries(typeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>{t('currency')}<select data-update-passive value={currency} onChange={e => setCurrency(e.target.value)}><option value="all">{t('cmAllCurrencies')}</option>{[...new Set(data.rows.map(r => r.account.currency))].map(c => <option key={c}>{c}</option>)}</select></label><label>{t('cmStatus')}<select data-update-passive value={status} onChange={e => setStatus(e.target.value)}><option value="all">{t('cmAllStatuses')}</option><option value="active">{t('cv2Active')}</option><option value="inactive">{t('cv2Inactive')}</option></select></label></div>}
      {!loaded && !data.rows.length ? <p className="cm-empty" role="status">{t('cmLoading')}</p> : !data.rows.length ? <div className="cm-empty"><Wallet size={25} /><h3>{t('noCashAccountsTitle')}</h3><p>{t('noCashAccountsDesc')}</p><button type="button" className="is-primary" onClick={onAddAccount}><Plus size={14} />{t('addFirstAccountBtn')}</button></div> : !visible.length ? <p className="cm-empty">{t('cmNoResults')}</p> : <div className={`cm-account-list ${view === 'list' ? 'cm-list-view' : ''}`}>{visible.map(row => {
        const { account: a } = row; const Icon = TYPE_ICONS[a.type]; const tone = a.type === 'hand' ? 'brand' : a.type === 'bank' ? 'blue' : 'purple';
        const formattedDate = row.lastTs ? new Date(row.lastTs).toLocaleString(t.lang === 'ar' ? 'ar-QA' : 'en-GB', { month: '2-digit', day: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '—';
        return <article key={a.id} className={`cm-account cm-tone-${tone} ${a.status === 'inactive' ? 'is-inactive' : ''}`} aria-label={a.name}>
          <div className="cm-account-header"><span className="cm-avatar">{Array.from(a.name.trim())[0] || '·'}</span><div className="cm-account-identity"><div><h3>{a.name}</h3><span className="cm-currency">{a.currency}</span><span className={`cm-status ${a.status === 'active' ? 'is-active' : ''}`}>{a.status === 'active' ? t('cv2Active') : t('cv2Inactive')}</span></div><p>{[typeLabels[a.type], a.bankName, a.branch].filter(Boolean).join(' · ')}</p></div><span className="cm-date"><CalendarDays size={12} /><time dateTime={row.lastTs ? new Date(row.lastTs).toISOString() : undefined}>{formattedDate}</time></span>{menu(a)}</div>
          <div className="cm-account-metrics"><div className="cm-balance"><Badge icon={Icon} /><div><span>{t('cv2Balance')}</span><strong className={row.balance < 0 ? 'cm-bad' : ''}>{fmtTotal(row.balance)} <small>{a.currency}</small></strong></div><div className="cm-account-change"><b className={row.change !== null && row.change < 0 ? 'cm-bad' : 'cm-good'}>{row.change !== null && (row.change < 0 ? <ArrowDown size={11} /> : <ArrowUp size={11} />)}{change(row.change)}</b><small>{row.change === null ? t('cmNoBaseline') : t('cmLastMonth')}</small></div><Trend values={row.trend} bars /></div><div className="cm-account-stat"><span><ClipboardList size={14} />{t('cv2Batches')}</span><strong>{row.batches}</strong></div><div className="cm-account-stat"><span><PieChart size={14} />{t('cv2Share')}</span><strong>{row.share === null ? '—' : `${Math.round(row.share)}%`}</strong></div><div className="cm-account-stat"><span><Clock3 size={14} />{t('cm24hChange')}</span><strong className={row.movement < 0 ? 'cm-bad' : row.movement > 0 ? 'cm-good' : ''}>{row.movement ? signed(row.movement) : '—'}</strong></div></div>
          <div className="cm-account-actions"><button type="button" className="cm-ledger" onClick={() => onAccountAction(a, 'ledger')}><BookOpen size={14} />{t('cmViewLedger')}</button>{a.status === 'active' && <><button type="button" onClick={() => onAccountAction(a, a.type === 'merchant_custody' ? 'funding' : 'deposit')}><CirclePlus size={14} />{t('cmAddCash')}</button><button type="button" onClick={() => onAccountAction(a, 'transfer')} disabled={(state.cashAccounts || []).filter(a => a.status === 'active').length < 2}><ArrowLeftRight size={14} />{t('transferLbl')}</button></>}{a.type !== 'hand' && <button type="button" onClick={() => exportStatement(a)}><FileText size={14} />{t('cmStatement')}</button>}{menu(a, true)}</div>
        </article>;
      })}</div>}
    </>}
  </div>;
}
