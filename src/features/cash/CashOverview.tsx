import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeftRight, Banknote, CalendarDays, ChevronDown, ChevronRight, Filter, HandCoins, Landmark, Plus, Scale, Search, Settings, ShieldCheck, Wallet, type LucideIcon } from 'lucide-react';
import { CashAccountActions } from './CashAccountActions';
import { useTheme } from '@/lib/theme-context';
import { CashInsights } from './CashInsights';
import { buildCashFlow, cashFlowWindow } from './cash-flow-model';
import { useT } from '@/lib/i18n';
import { fmtTotal, type CashAccount, type CashAccountType, type TrackerState } from '@/lib/tracker-helpers';
import { csvCell, downloadTextFile } from '@/features/stock/utils/loanStatementExport';
import { useNetPositionDays, useNetPositionSettings, usePersonalLoans } from '@/features/net-position/api';
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
  onNewLoan?: () => void;
  onAccountAction: (account: CashAccount, action: CashAccountAction) => void;
  loaded: boolean;
  now?: number;
}
const COLLAPSED_ACCOUNTS = 5;
const TYPE_ICONS: Record<CashAccountType, LucideIcon> = { hand: Wallet, bank: Landmark, vault: ShieldCheck, merchant_custody: HandCoins };
const TYPE_TONES: Record<CashAccountType, string> = { hand: 'good', bank: 'brand', vault: 'warn', merchant_custody: 'warn' };
const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${fmtTotal(Math.abs(n))}`;
const clean = (s: string) => s.replace(/^[^\p{L}\p{N}]+\s*/u, '');

/** A filled line chart that stretches to its box and takes its colour from the surrounding text. */
function Sparkline({ values }: { values: number[] }) {
  const low = Math.min(...values), high = Math.max(...values), span = high - low || 1;
  const points = values.map((n, i) => `${(i * 100 / Math.max(1, values.length - 1)).toFixed(2)},${(36 - (n - low) / span * 32).toFixed(2)}`);
  return <svg className="cm-spark" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
    <polygon points={`0,40 ${points.join(' ')} 100,40`} fill="currentColor" fillOpacity=".14" />
    <polyline points={points.join(' ')} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
  </svg>;
}

function NetPosition({ state, onOpen, netFlow, rangeLabel }: { state: TrackerState; onOpen: () => void; netFlow: number; rangeLabel: string }) {
  const t = useT();
  const { settings, loaded, unavailable } = useNetPositionSettings();
  const { loans, loaded: loansLoaded, unavailable: loansUnavailable } = usePersonalLoans();
  const exchange = useExchangeBalances();
  const { days } = useNetPositionDays();
  const history = days.filter(d => Number.isFinite(d.net)).slice(-30);
  const position = useMemo(() => {
    if (!loaded || !loansLoaded || !exchange.isSuccess || unavailable || loansUnavailable) return null;
    const sums = { binance: 0, okx: 0 };
    for (const b of exchange.data || []) if (b.asset === 'USDT') sums[b.exchange] += b.free + b.locked;
    return computePosition({ accounts: state.cashAccounts || [], ledger: state.cashLedger || [], includedAccountIds: new Set(settings?.includedAccounts || []), customerLoans: state.customerLoans || [], deletedLoanIds: state.deletedLoanIds, customerName: id => id, personalLoans: loans, exchange: sums, batches: state.batches || [] });
  }, [state, settings, loaded, unavailable, loans, loansLoaded, loansUnavailable, exchange.data, exchange.isSuccess]);
  return <button className="cm-hero-main" type="button" onClick={onOpen}>
    <span className="cm-hero-label"><Scale size={15} />{t('cmNetPosition')}<ChevronRight size={14} className="cm-flip" /></span>
    <span className="cm-hero-value"><strong className={position && position.netQAR < 0 ? 'cm-bad' : ''}>{position ? signed(position.netQAR) : '—'}</strong><em>QAR</em></span>
    <span className={`cm-hero-flow ${netFlow < 0 ? 'cm-bad' : netFlow > 0 ? 'cm-good' : ''}`}>{signed(netFlow)} {t('cmNetFlowLbl')} · {rangeLabel}</span>
    {history.length > 1 && <Sparkline values={history.map(d => d.net)} />}
  </button>;
}

export function CashOverview({ state, section, onSection, onAddAccount, onAddCash, onTransfer, onCustody, onNewLoan, onAccountAction, loaded, now = Date.now() }: Props) {
  const t = useT(); const navigate = useNavigate();
  const { settings, update } = useTheme();
  const range = settings.range || '30d';
  const window = cashFlowWindow(state.cashLedger || [], now, range);
  const rangeLabels = { today: t('today'), '7d': t('cmLast7'), '30d': t('cmLast30'), this_month: t('cmThisMonth'), last_month: t('cmPreviousMonth'), all: t('all') };
  const dateLabel = (ts: number) => new Date(ts).toLocaleDateString(t.lang === 'ar' ? 'ar-QA' : 'en-GB', { month: 'short', day: 'numeric' });
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [type, setType] = useState('all'), [currency, setCurrency] = useState('all'), [status, setStatus] = useState('all');
  const data = useMemo(() => buildCashOverview(state, now), [state, now]);
  const flow = useMemo(() => buildCashFlow(state, now, range), [state, now, range]);
  const typeLabels: Record<CashAccountType, string> = { hand: t('inHandLbl'), bank: t('banksLbl'), vault: t('vaultLbl'), merchant_custody: t('kpiCustody') };
  const visible = data.rows.filter(({ account: a }) => (!query.trim() || [a.name, a.bankName, a.branch, a.currency].filter(Boolean).join(' ').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) && (type === 'all' || a.type === type) && (currency === 'all' || a.currency === currency) && (status === 'all' || a.status === status));
  const hasFilters = type !== 'all' || currency !== 'all' || status !== 'all';
  const narrowed = !!query.trim() || hasFilters;
  const shown = narrowed || showAll ? visible : visible.slice(0, COLLAPSED_ACCOUNTS);
  const hidden = visible.length - shown.length;
  const change = (n: number | null) => n === null ? '—' : `${n > 0 ? '+' : ''}${Math.round(n)}%`;
  const activeCount = (state.cashAccounts || []).filter(a => a.status === 'active').length;
  const owedRows = data.rows.filter(r => r.account.status === 'active' && r.account.type !== 'merchant_custody' && r.balance < 0).sort((a, b) => a.balance - b.balance);
  const tabs: { id: CashSection; label: string }[] = [
    { id: 'accounts', label: clean(t('cashAccountsTab')) }, { id: 'flow', label: clean(t('cashFlowTab')) }, { id: 'loans', label: clean(t('cashLoansTab')) }, { id: 'position', label: clean(t('cashPositionTab')) }, { id: 'statements', label: clean(t('cashStatementsTab')) },
  ];
  const actions = [
    { key: 'cash', label: t('cmAddCash'), Icon: Banknote, onClick: onAddCash, primary: true, disabled: false },
    { key: 'transfer', label: t('transferLbl'), Icon: ArrowLeftRight, onClick: onTransfer, primary: false, disabled: activeCount < 2 },
    { key: 'loan', label: t('newLoan').replace(/^\+\s*/, ''), Icon: HandCoins, onClick: onNewLoan || (() => onSection('loans')), primary: false, disabled: false },
    { key: 'custody', label: t('kpiCustody'), Icon: ShieldCheck, onClick: onCustody, primary: false, disabled: false },
  ];
  const exportStatement = (account: CashAccount) => {
    const entries = (state.cashLedger || []).filter(e => e.accountId === account.id).sort((a, b) => a.ts - b.ts);
    let balance = 0;
    const csv = [[t('time'), t('type'), t('note'), t('currency'), t('amount'), t('cv2Balance')].map(csvCell).join(','), ...entries.map(e => { const amount = e.direction === 'in' ? e.amount : -e.amount; balance += amount; return [new Date(e.ts).toISOString(), e.type, e.note || '', account.currency, amount, Number(balance.toFixed(2))].map(csvCell).join(','); })].join('\r\n');
    downloadTextFile(`account-${account.id}-${new Date(now).toISOString().slice(0, 10)}.csv`, csv);
  };

  return <div className="cm-overview" dir={t.isRTL ? 'rtl' : 'ltr'}>
    <header className="cm-heading">
      <div><h1>{t('cashManagement')}</h1>
        <label className="cm-period"><CalendarDays size={14} /><span><select aria-label={t('cmPeriod')} value={range} onChange={e => update({ range: e.target.value as typeof settings.range })}>{Object.entries(rangeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><small>{dateLabel(window.start)} – {dateLabel(window.end)}</small></span><ChevronDown size={14} /></label>
      </div>
      <button type="button" className="cm-icon-button" aria-label={t('settings')} onClick={() => navigate('/settings')}><Settings size={19} /></button>
    </header>

    <nav className="cm-tabs" aria-label={t('cashManagement')}>{tabs.map(({ id, label }) => <button key={id} type="button" className={section === id ? 'is-active' : ''} aria-current={section === id ? 'page' : undefined} onClick={() => onSection(id)}>{label}</button>)}</nav>

    {section === 'accounts' && <>
      <section className="cm-hero" aria-label={t('cmNetPosition')}>
        <NetPosition state={state} onOpen={() => onSection('position')} netFlow={flow.inflow - flow.outflow} rangeLabel={rangeLabels[range]} />
        <div className="cm-hero-split">
          <button type="button" onClick={() => onSection('accounts')}><span>{t('totalCashLbl')}</span><strong>{fmtTotal(data.total.balance)}</strong><small className={data.total.change !== null && data.total.change < 0 ? 'cm-bad' : 'cm-good'}>{data.total.change !== null && (data.total.change < 0 ? '▼ ' : '▲ ')}{change(data.total.change)} {data.total.change === null ? t('cmNoBaseline') : t('cmLastMonth')}</small></button>
          <button type="button" onClick={() => onSection('loans')}><span>{t('kpiLoansOut')}</span><strong>{fmtTotal(data.loan.remaining)}</strong><small className={data.loan.change !== null && data.loan.change < 0 ? 'cm-muted' : 'cm-good'}>{data.loan.change !== null && (data.loan.change < 0 ? '▼ ' : '▲ ')}{change(data.loan.change)} {data.loan.change === null ? t('cmNoBaseline') : t('cmLastMonth')}</small></button>
        </div>
      </section>

      <div className="cm-actions" role="group" aria-label={t('cmQuickActions')}>{actions.map(({ key, label, Icon, onClick, primary, disabled }) => <button key={key} type="button" className={primary ? 'is-primary' : ''} onClick={onClick} disabled={disabled}><Icon size={20} /><span>{label}</span></button>)}</div>

      {owedRows.length > 0 && <div className="cm-owed-strip">
        <p role="status">{t('youOweAmount')} {owedRows.length === 1 ? `${owedRows[0].account.name} ${fmtTotal(-owedRows[0].balance)} ${owedRows[0].account.currency}` : data.owed.map(o => `${fmtTotal(o.amount)} ${o.currency}`).join(' · ')}</p>
        <button type="button" onClick={() => onAccountAction(owedRows[0].account, 'deposit')}>{t('cmSettle')}</button>
      </div>}

      <div className="cm-columns">
        <section className="cm-accounts-panel" aria-label={clean(t('cashAccountsTab'))}>
          <div className="cm-section-head"><h2>{clean(t('cashAccountsTab'))} <span>{data.rows.length}</span></h2>
            <button type="button" className="cm-icon-button is-small" aria-label={t('cmSearch')} aria-expanded={searchOpen} onClick={() => setSearchOpen(v => !v)}><Search size={16} /></button>
            <button type="button" className="cm-link" onClick={onAddAccount}><Plus size={14} />{t('addAccountBtn').replace(/^\+\s*/, '')}</button>
          </div>
          {searchOpen && <div className="cm-search-row"><label className="cm-search"><Search size={15} /><input data-update-passive type="search" value={query} onChange={e => setQuery(e.target.value)} aria-label={t('cmSearch')} placeholder={t('cmSearch')} /></label><button type="button" className={`cm-icon-button is-small ${hasFilters ? 'is-active' : ''}`} onClick={() => setFiltersOpen(v => !v)} aria-expanded={filtersOpen} aria-label={t('cmFilter')}><Filter size={16} /></button></div>}
          {searchOpen && filtersOpen && <div className="cm-filters"><label>{t('cmAccountType')}<select data-update-passive value={type} onChange={e => setType(e.target.value)}><option value="all">{t('cmAllTypes')}</option>{Object.entries(typeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>{t('currency')}<select data-update-passive value={currency} onChange={e => setCurrency(e.target.value)}><option value="all">{t('cmAllCurrencies')}</option>{[...new Set(data.rows.map(r => r.account.currency))].map(c => <option key={c}>{c}</option>)}</select></label><label>{t('cmStatus')}<select data-update-passive value={status} onChange={e => setStatus(e.target.value)}><option value="all">{t('cmAllStatuses')}</option><option value="active">{t('cv2Active')}</option><option value="inactive">{t('cv2Inactive')}</option></select></label></div>}
          {!loaded && !data.rows.length ? <p className="cm-empty" role="status">{t('cmLoading')}</p> : !data.rows.length ? <div className="cm-empty"><Wallet size={25} /><h3>{t('noCashAccountsTitle')}</h3><p>{t('noCashAccountsDesc')}</p><button type="button" className="is-primary" onClick={onAddAccount}><Plus size={14} />{t('addFirstAccountBtn')}</button></div> : !visible.length ? <p className="cm-empty">{t('cmNoResults')}</p> : <div className="cm-account-list">
            {shown.map(row => {
              const { account: a } = row; const Icon = TYPE_ICONS[a.type]; const owed = row.balance < 0;
              const sub = [typeLabels[a.type], a.bankName, a.currency, row.batches ? `${row.batches} ${t('cv2Batches').toLocaleLowerCase()}` : ''].filter(Boolean).join(' · ');
              return <article key={a.id} className={`cm-row ${a.status === 'inactive' ? 'is-inactive' : ''}`} style={{ ['--cm-tone' as string]: `var(--${owed ? 'bad' : TYPE_TONES[a.type]})` }} aria-label={a.name}>
                <button type="button" className="cm-row-main" aria-label={`${t('cmViewLedger')} · ${a.name}`} onClick={() => onAccountAction(a, 'ledger')}>
                  <span className="cm-row-icon"><Icon size={20} /></span>
                  <span className="cm-row-text"><b>{a.name}{a.status === 'inactive' && <em>{t('cv2Inactive')}</em>}</b><small>{sub}</small></span>
                  <span className="cm-row-amount"><strong className={owed ? 'cm-bad' : ''}>{fmtTotal(row.balance)}</strong>
                    {owed ? <small className="cm-owe">{t('youOweAmount')}</small>
                      : row.movement ? <small className={row.movement > 0 ? 'cm-good' : 'cm-bad'}>{signed(row.movement)} {t('today')}</small>
                      : row.change !== null && row.change !== 0 ? <small className={row.change < 0 ? 'cm-bad' : 'cm-good'}>{row.change < 0 ? '▼' : '▲'} {change(Math.abs(row.change))}</small>
                      : <small className="cm-muted">{t('cmNoChange')}</small>}
                  </span>
                </button>
                <CashAccountActions account={a} balance={row.balance} canTransfer={activeCount > 1} onAction={onAccountAction} onStatement={exportStatement} />
              </article>;
            })}
            {hidden > 0 && <button type="button" className="cm-more" onClick={() => setShowAll(true)}>{t('cmShowMore').replace('{n}', String(hidden))}</button>}
            {showAll && !narrowed && visible.length > COLLAPSED_ACCOUNTS && <button type="button" className="cm-more" onClick={() => setShowAll(false)}>{t('cmShowLess')}</button>}
          </div>}
        </section>

        <aside className="cm-side">
          {data.loan.given > 0 && <section className="cm-card" aria-label={t('cmLoanPortfolio')}>
            <div className="cm-section-head"><h2>{t('cashLoansTab').replace(/^[^\p{L}\p{N}]+\s*/u, '')}</h2><span className="cm-good cm-head-note">{Math.round(data.loan.percent)}% {t('kpiLoansRepaid').toLocaleLowerCase()}</span></div>
            <div className="cm-progress" role="progressbar" aria-label={t('kpiLoansRepaid')} aria-valuenow={Math.round(data.loan.percent)} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${data.loan.percent}%` }} /></div>
            <div className="cm-loan-figures"><div><span>{t('kpiLoansGiven')}</span><strong>{fmtTotal(data.loan.given)}</strong></div><div><span>{t('kpiLoansRepaid')}</span><strong>{fmtTotal(data.loan.repaid)}</strong></div><div><span>{t('cmRemaining')}</span><strong className="cm-warn">{fmtTotal(data.loan.remaining)}</strong></div></div>
            {data.otherLoans.map(l => <p key={l.currency} className="cm-loan-other">{l.currency} · {t('kpiLoansGiven')} {fmtTotal(l.given)} · {t('kpiLoansRepaid')} {fmtTotal(l.repaid)} · {t('cmRemaining')} {fmtTotal(l.remaining)}</p>)}
            <button type="button" className="cm-more" onClick={() => onSection('loans')}>{t('cashLoansTab').replace(/^[^\p{L}\p{N}]+\s*/u, '')} <ChevronRight size={14} className="cm-flip" /></button>
          </section>}
          <CashInsights flow={flow} rangeLabel={rangeLabels[range]} onSection={onSection} />
        </aside>
      </div>
    </>}
  </div>;
}
