import { ArrowDown, ArrowLeftRight, ArrowUp, Check, ChevronRight } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { fmtTotal } from '@/lib/tracker-helpers';
import type { CashSection } from './CashOverview';
import type { buildCashFlow } from './cash-flow-model';

interface Props {
  flow: ReturnType<typeof buildCashFlow>;
  rangeLabel: string;
  onSection: (section: CashSection) => void;
}

export function CashInsights({ flow, rangeLabel, onSection }: Props) {
  const t = useT();
  const max = Math.max(1, ...flow.bins.flatMap(b => [b.inflow, b.outflow]));
  const date = (ts: number) => new Date(ts).toLocaleDateString(t.lang === 'ar' ? 'ar-QA' : 'en-GB', { month: 'short', day: 'numeric' });
  return <>
    <section className="cm-card cm-flow-panel" aria-label={t('cmCashFlow')}>
      <div className="cm-section-head"><h2>{t('cmCashFlow')}</h2><span className="cm-head-note">{rangeLabel}</span></div>
      <div className="cm-flow-totals"><div><span className="cm-activity-icon cm-good"><ArrowUp size={16} /></span><span>{t('cmInflow')}<strong className="cm-good">+{fmtTotal(flow.inflow)} <small>QAR</small></strong></span></div><div><span className="cm-activity-icon cm-bad"><ArrowDown size={16} /></span><span>{t('cmOutflow')}<strong className="cm-bad">−{fmtTotal(flow.outflow)} <small>QAR</small></strong></span></div></div>
      <svg className="cm-flow-chart" viewBox="0 0 300 156" role="img" aria-label={`${t('cmInflow')}: ${fmtTotal(flow.inflow)} QAR; ${t('cmOutflow')}: ${fmtTotal(flow.outflow)} QAR`}>
        {[22, 53, 84, 115, 146].map((y, i) => <g key={y}><line x1="31" x2="296" y1={y} y2={y} stroke="var(--line)" strokeDasharray={i === 2 ? undefined : '2 3'} /><text x="25" y={y + 3} textAnchor="end">{new Intl.NumberFormat(t.lang, { notation: 'compact', maximumFractionDigits: 1 }).format(max * (2 - i) / 2)}</text></g>)}
        {flow.bins.map((b, i) => { const x = 33 + i * 260 / flow.bins.length; const width = Math.max(1, 260 / flow.bins.length * .65); return <g key={b.ts}><title>{date(b.ts)}: +{fmtTotal(b.inflow)} / −{fmtTotal(b.outflow)} QAR</title><rect x={x} y={84 - b.inflow / max * 60} width={width} height={b.inflow / max * 60} rx="1.5" fill="var(--good)" /><rect x={x} y="84" width={width} height={b.outflow / max * 60} rx="1.5" fill="var(--bad)" /></g>; })}
      </svg>
      <div className="cm-flow-dates">{[0, .33, .66, 1].map(part => <span key={part}>{date(flow.start + (flow.end - flow.start) * part)}</span>)}</div>
      {!flow.inflow && !flow.outflow && <p className="cm-no-flow">{t('cmNoFlow')}</p>}
    </section>
    <section className="cm-card cm-recent"><div className="cm-section-head"><h2>{t('recentActivity')}</h2><button type="button" className="cm-link" onClick={() => onSection('flow')}>{t('viewAllNotifications')}<ChevronRight size={14} className="cm-flip" /></button></div>
      {flow.recent.length ? flow.recent.map(e => {
        const a = flow.accounts.get(e.accountId);
        const transfer = e.type === 'transfer_out';
        const Icon = transfer ? ArrowLeftRight : e.type === 'loan_repayment' ? Check : e.direction === 'in' ? ArrowUp : ArrowDown;
        const label = transfer ? t('transferLbl') : e.type === 'loan_repayment' ? t('cmRepayment') : e.type === 'deposit' ? t('cmCashAdded') : t(e.type === 'opening' ? 'cmOpening' : e.direction === 'in' ? 'cmInflow' : 'cmOutflow');
        return <button type="button" className="cm-activity" key={e.id} onClick={() => onSection('flow')}><span className={`cm-activity-icon ${transfer ? 'cm-transfer-icon' : e.direction === 'in' ? 'cm-good' : 'cm-bad'}`}><Icon size={17} /></span><span><b>{label}</b><small>{a?.name} · {date(e.ts)}, {new Date(e.ts).toLocaleTimeString(t.lang, { hour: '2-digit', minute: '2-digit', hour12: false })}</small></span><strong className={e.direction === 'in' ? 'cm-good' : 'cm-bad'}>{e.direction === 'in' ? '+' : '−'}{fmtTotal(e.amount)} <small>{e.currency}</small></strong></button>;
      }) : <p className="cm-no-flow">{t('cmNoFlow')}</p>}
    </section>
  </>;
}
