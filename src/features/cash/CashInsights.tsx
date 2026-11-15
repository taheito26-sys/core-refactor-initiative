import { useMemo } from 'react';
import { ArrowDown, ArrowLeftRight, ArrowUp, Banknote, Check, ChevronRight, Clock3, FileText, HandCoins, Plus, ShieldCheck, Zap } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { fmtTotal, type TrackerState } from '@/lib/tracker-helpers';
import type { CashSection } from './CashOverview';
import { buildCashFlow } from './cash-flow-model';

interface Props {
  state: TrackerState;
  now: number;
  range: string;
  rangeLabel: string;
  onSection: (section: CashSection) => void;
  onAddAccount: () => void;
  onAddCash: () => void;
  onTransfer: () => void;
  onCustody: () => void;
  onNewLoan?: () => void;
}

export function CashInsights({ state, now, range, rangeLabel, onSection, onAddAccount, onAddCash, onTransfer, onCustody, onNewLoan }: Props) {
  const t = useT();
  const flow = useMemo(() => buildCashFlow(state, now, range), [state, now, range]);
  const max = Math.max(1, ...flow.bins.flatMap(b => [b.inflow, b.outflow]));
  const date = (ts: number) => new Date(ts).toLocaleDateString(t.lang === 'ar' ? 'ar-QA' : 'en-GB', { month: 'short', day: 'numeric' });
  const actions = [
    { key: 'account', label: t('addAccountBtn').replace(/^\+\s*/, ''), Icon: Plus, onClick: onAddAccount, tone: 'blue' },
    { key: 'cash', label: t('cmAddCash'), Icon: Banknote, onClick: onAddCash, tone: 'brand' },
    { key: 'transfer', label: t('transferLbl'), Icon: ArrowLeftRight, onClick: onTransfer, tone: 'purple' },
    { key: 'custody', label: t('kpiCustody'), Icon: ShieldCheck, onClick: onCustody, tone: 'gold' },
    { key: 'loan', label: t('newLoan').replace(/^\+\s*/, ''), Icon: HandCoins, onClick: onNewLoan || (() => onSection('loans')), tone: 'blue' },
    { key: 'statement', label: t('cmStatement'), Icon: FileText, onClick: () => onSection('statements'), tone: 'slate' },
  ];
  return <aside className="cm-insights">
    <section className="cm-insight-panel cm-flow-panel" aria-label={t('cmCashFlow')}>
      <h2><ArrowLeftRight size={19} />{t('cmCashFlow')} <small>({rangeLabel})</small></h2>
      <div className="cm-flow-totals"><div><span className="cm-activity-icon cm-good"><ArrowUp size={16} /></span><span>{t('cmInflow')}<strong className="cm-good">+{fmtTotal(flow.inflow)} <small>QAR</small></strong></span></div><div><span className="cm-activity-icon cm-bad"><ArrowDown size={16} /></span><span>{t('cmOutflow')}<strong className="cm-bad">−{fmtTotal(flow.outflow)} <small>QAR</small></strong></span></div></div>
      <svg className="cm-flow-chart" viewBox="0 0 300 156" role="img" aria-label={`${t('cmInflow')}: ${fmtTotal(flow.inflow)} QAR; ${t('cmOutflow')}: ${fmtTotal(flow.outflow)} QAR`}>
        {[22, 53, 84, 115, 146].map((y, i) => <g key={y}><line x1="31" x2="296" y1={y} y2={y} stroke="var(--line)" strokeDasharray={i === 2 ? undefined : '2 3'} /><text x="25" y={y + 3} textAnchor="end">{new Intl.NumberFormat(t.lang, { notation: 'compact', maximumFractionDigits: 1 }).format(max * (2 - i) / 2)}</text></g>)}
        {flow.bins.map((b, i) => { const x = 33 + i * 260 / flow.bins.length; const width = Math.max(1, 260 / flow.bins.length * .65); return <g key={b.ts}><title>{date(b.ts)}: +{fmtTotal(b.inflow)} / −{fmtTotal(b.outflow)} QAR</title><rect x={x} y={84 - b.inflow / max * 60} width={width} height={b.inflow / max * 60} rx="1.5" fill="var(--good)" /><rect x={x} y="84" width={width} height={b.outflow / max * 60} rx="1.5" fill="var(--bad)" /></g>; })}
      </svg>
      <div className="cm-flow-dates">{[0, .33, .66, 1].map(part => <span key={part}>{date(flow.start + (flow.end - flow.start) * part)}</span>)}</div>
      {!flow.inflow && !flow.outflow && <p className="cm-no-flow">{t('cmNoFlow')}</p>}
    </section>
    <section className="cm-insight-panel"><h2><Zap size={19} />{t('cmQuickActions')}</h2><div className="cm-quick-actions">{actions.map(({ key, label, Icon, onClick, tone }) => <button key={key} type="button" className={`cm-tone-${tone}`} onClick={onClick} disabled={key === 'transfer' && (state.cashAccounts || []).filter(a => a.status === 'active').length < 2}><Icon size={22} /><span>{label}</span></button>)}</div></section>
    <section className="cm-insight-panel cm-recent"><h2><Clock3 size={19} />{t('recentActivity')}<button type="button" onClick={() => onSection('flow')}>{t('viewAllNotifications')}<ChevronRight size={12} /></button></h2>
      {flow.recent.length ? flow.recent.map(e => {
        const a = flow.accounts.get(e.accountId);
        const transfer = e.type === 'transfer_out';
        const Icon = transfer ? ArrowLeftRight : e.type === 'loan_repayment' ? Check : e.direction === 'in' ? ArrowUp : ArrowDown;
        const label = transfer ? t('transferLbl') : e.type === 'loan_repayment' ? t('cmRepayment') : e.type === 'deposit' ? t('cmCashAdded') : t(e.type === 'opening' ? 'cmOpening' : e.direction === 'in' ? 'cmInflow' : 'cmOutflow');
        return <button type="button" className="cm-activity" key={e.id} onClick={() => onSection('flow')}><span className={`cm-activity-icon ${transfer ? 'cm-transfer-icon' : e.direction === 'in' ? 'cm-good' : 'cm-bad'}`}><Icon size={17} /></span><span><b>{label}</b><small>{a?.name} · {date(e.ts)}, {new Date(e.ts).toLocaleTimeString(t.lang, { hour: '2-digit', minute: '2-digit', hour12: false })}</small></span><strong className={e.direction === 'in' ? 'cm-good' : 'cm-bad'}>{e.direction === 'in' ? '+' : '−'}{fmtTotal(e.amount)} <small>{e.currency}</small></strong></button>;
      }) : <p className="cm-no-flow">{t('cmNoFlow')}</p>}
    </section>
  </aside>;
}
