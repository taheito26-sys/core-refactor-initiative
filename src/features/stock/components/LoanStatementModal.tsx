import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useT } from '@/lib/i18n';
import type { CustomerLoan } from '@/lib/tracker-helpers';
import type { BuyerStatement, StatementEntry } from '@/features/stock/utils/loanStatement';
import {
  buildStatementCsv, buildStatementHtml, buildStatementHtmlCompact, buildStatementText,
  downloadTextFile, formatMoney, printHtmlDocument, statementFileBase,
} from '@/features/stock/utils/loanStatementExport';
import { statementLabels } from '@/features/stock/utils/statementLabels';

type StatementLayout = 'classic' | 'compact';

interface LoanStatementModalProps {
  statement: BuyerStatement;
  /** Printed as the issuer at the top of the exported document. */
  businessName?: string;
  isMobile?: boolean;
  onClose: () => void;
  /** Opens the repayment form for one of the buyer's loans. */
  onAddRepayment?: (loan: CustomerLoan) => void;
  /** Opens a recorded payment for correction. Omit to keep the statement read-only. */
  onEditRepayment?: (entry: StatementEntry) => void;
  onDeleteRepayment?: (entry: StatementEntry) => void;
}

/**
 * The buyer's account, laid out the way a statement is: what was loaned, what
 * came back, and the running balance between them.
 *
 * The same statement is what the export buttons produce — the on-screen view
 * and the PDF/spreadsheet are built from one model, so what the buyer receives
 * is exactly what was reviewed here.
 */
export function LoanStatementModal({
  statement, businessName, isMobile = false, onClose, onAddRepayment, onEditRepayment, onDeleteRepayment,
}: LoanStatementModalProps) {
  const t = useT();
  const labels = useMemo(() => statementLabels(t), [t]);
  const docOptions = useMemo(() => ({ businessName, lang: t.lang }), [businessName, t]);
  const [layout, setLayout] = useState<StatementLayout>('classic');

  const payments = useMemo(() => statement.entries.filter(e => e.kind === 'payment'), [statement]);
  const canEditPayments = !!(onEditRepayment || onDeleteRepayment);
  const cur = statement.currency;

  const fmtDay = (ts: number) => new Date(ts).toLocaleDateString(t.lang === 'ar' ? 'ar' : 'en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
  const fmtDayTime = (ts: number) => `${fmtDay(ts)} · ${new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

  const exportCsv = () => {
    const csv = buildStatementCsv(statement, labels, docOptions);
    downloadTextFile(`${statementFileBase(statement)}.csv`, csv);
    toast.success(t('loanExported'));
  };

  const exportPdf = () => {
    const html = layout === 'compact'
      ? buildStatementHtmlCompact(statement, labels, docOptions)
      : buildStatementHtml(statement, labels, docOptions);
    if (!printHtmlDocument(html)) {
      // In-app webviews have no print dialog — the spreadsheet still gets there.
      exportCsv();
      toast.info(t('loanPrintUnavailable'));
    }
  };

  const copySummary = async () => {
    const text = buildStatementText(statement, labels, docOptions);
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t('loanCopied'));
    } catch {
      toast.error(t('loanCopyFailed'));
    }
  };

  const num = (n: number, tone?: 'good' | 'bad') => (
    <span className="mono" style={{ fontWeight: 700, color: tone === 'good' ? 'var(--good)' : tone === 'bad' ? 'var(--bad)' : undefined }}>
      {formatMoney(n)}
    </span>
  );

  const sectionTitle = (text: string) => (
    <div style={{
      fontSize: 9, fontWeight: 800, letterSpacing: '.8px', textTransform: 'uppercase',
      color: 'var(--muted)', margin: '16px 0 6px',
    }}>
      {text}
    </div>
  );

  const aging: Array<[string, number]> = [
    [labels.agingCurrent, statement.aging.current],
    [labels.aging31, statement.aging.d31],
    [labels.aging61, statement.aging.d61],
    [labels.aging90, statement.aging.d90plus],
  ];

  return (
    <div
      className="tracker-root"
      style={{
        position: 'fixed', inset: 0, zIndex: 9999, display: 'flex',
        alignItems: isMobile ? 'flex-end' : 'center', justifyContent: 'center',
        padding: isMobile ? 0 : 16,
      }}
      onClick={onClose}
    >
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }} />
      <div
        style={{
          position: 'relative', zIndex: 1, background: 'var(--panel)', border: '1px solid var(--line)',
          borderRadius: isMobile ? '14px 14px 0 0' : 12, width: '100%', maxWidth: 940,
          maxHeight: isMobile ? '94vh' : '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header — who the statement is for, and what it settles */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12,
          padding: isMobile ? '12px 12px 10px' : '16px 20px 12px', borderBottom: '1px solid var(--line)',
        }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: '.8px', textTransform: 'uppercase', color: 'var(--muted)' }}>
              {t('loanStatementFor')}
            </div>
            <div style={{ fontSize: isMobile ? 15 : 17, fontWeight: 800, marginTop: 2 }}>{statement.customerName}</div>
            <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {statement.phone && <span className="mono">{statement.phone}</span>}
              <span>{labels.period}: {fmtDay(statement.firstActivityTs)} — {fmtDay(statement.lastActivityTs)}</span>
              <span className="pill" style={{ fontSize: 9 }}>{cur}</span>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label={t('cancel')}
            style={{ background: 'transparent', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}
          >
            ✕
          </button>
        </div>

        {/* Export bar — the whole point of the screen */}
        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center',
          padding: isMobile ? '10px 12px' : '10px 20px', borderBottom: '1px solid var(--line2)',
        }}>
          <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '.6px', textTransform: 'uppercase', color: 'var(--muted)' }}>
            {t('loanStatementLayout')}
          </span>
          <select
            value={layout}
            onChange={e => setLayout(e.target.value as StatementLayout)}
            className="rowBtn"
            style={{ padding: '4px 8px', fontSize: 11 }}
          >
            <option value="classic">{t('loanStatementLayoutClassic')}</option>
            <option value="compact">{t('loanStatementLayoutCompact')}</option>
          </select>
          <button className="btn" style={{ padding: '6px 14px', fontSize: 11 }} onClick={exportPdf}>🖨 {t('loanExportPdf')}</button>
          <button className="rowBtn" onClick={exportCsv}>📊 {t('loanExportExcel')}</button>
          <button className="rowBtn" onClick={copySummary}>📋 {t('loanCopySummary')}</button>
        </div>

        <div style={{ overflowY: 'auto', padding: isMobile ? '12px' : '14px 20px 20px' }}>
          {/* Totals */}
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)', gap: 8 }}>
            {([
              [labels.totalLoaned, statement.totalLoaned, undefined],
              [labels.totalRepaid, statement.totalRepaid, 'good'],
              [labels.totalDue, statement.outstanding, statement.outstanding > 0 ? 'bad' : 'good'],
            ] as const).map(([label, value, tone]) => (
              <div
                key={label}
                className="panel"
                style={{
                  padding: '10px 12px',
                  background: tone === 'bad' ? 'color-mix(in srgb, var(--bad) 8%, var(--panel2))' : 'var(--panel2)',
                  borderColor: tone === 'bad' ? 'color-mix(in srgb, var(--bad) 30%, transparent)' : undefined,
                }}
              >
                <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: '.6px', textTransform: 'uppercase', color: 'var(--muted)' }}>{label}</div>
                <div style={{ marginTop: 3, fontSize: 17 }}>
                  {num(value, tone as 'good' | 'bad' | undefined)}
                  <span className="mono" style={{ fontSize: 10, color: 'var(--muted)', marginInlineStart: 4 }}>{cur}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Aging — how old the unpaid part is */}
          {statement.outstanding > 0 && (
            <>
              {sectionTitle(labels.aging)}
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)', gap: 6 }}>
                {aging.map(([label, value]) => (
                  <div key={label} className="panel" style={{ padding: '7px 10px', background: 'var(--panel2)' }}>
                    <div style={{ fontSize: 8.5, fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted)' }}>{label}</div>
                    <div className="mono" style={{ fontSize: 12, fontWeight: 700, marginTop: 2, color: value > 0 ? 'var(--text)' : 'var(--muted2)' }}>
                      {formatMoney(value)}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Loaned orders */}
          {sectionTitle(`${labels.loanedOrders} · ${statement.loans.length}`)}
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>{labels.ref}</th>
                  <th>{labels.date}</th>
                  <th>{labels.description}</th>
                  <th className="r">{labels.amount}</th>
                  <th className="r">{labels.paid}</th>
                  <th className="r">{labels.remaining}</th>
                  <th>{labels.status}</th>
                  {onAddRepayment && <th />}
                </tr>
              </thead>
              <tbody>
                {statement.loans.map(row => (
                  <tr key={row.loan.id}>
                    <td className="mono" style={{ whiteSpace: 'nowrap' }}>{row.ref}</td>
                    <td className="mono" style={{ whiteSpace: 'nowrap' }}>{fmtDay(row.loan.ts)}</td>
                    <td style={{ color: 'var(--muted)', minWidth: 160 }}>{row.loan.note || '—'}</td>
                    <td className="r">{num(row.principal)}</td>
                    <td className="r">{num(row.repaid, 'good')}</td>
                    <td className="r">{num(row.remaining, row.remaining > 0 ? 'bad' : 'good')}</td>
                    <td>
                      <span className={`pill ${row.settled ? 'good' : 'warn'}`} style={{ fontSize: 9 }}>
                        {row.settled ? t('loanStatusClosed') : `${t('loanStatusOpen')} · ${row.ageDays}${t('loanDaysShort')}`}
                      </span>
                    </td>
                    {onAddRepayment && (
                      <td style={{ textAlign: 'end' }}>
                        {!row.settled && (
                          <button
                            className="rowBtn"
                            style={{ padding: '2px 8px', fontSize: 9, minHeight: 22, whiteSpace: 'nowrap' }}
                            onClick={() => onAddRepayment(row.loan)}
                          >
                            + {t('loanAddRepayment')}
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3} style={{ fontWeight: 700, borderTop: '1px solid var(--line)' }}>{labels.summary}</td>
                  <td className="r" style={{ borderTop: '1px solid var(--line)' }}>{num(statement.totalLoaned)}</td>
                  <td className="r" style={{ borderTop: '1px solid var(--line)' }}>{num(statement.totalRepaid, 'good')}</td>
                  <td className="r" style={{ borderTop: '1px solid var(--line)' }}>{num(statement.outstanding, statement.outstanding > 0 ? 'bad' : 'good')}</td>
                  <td colSpan={onAddRepayment ? 2 : 1} style={{ borderTop: '1px solid var(--line)' }} />
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Payments received */}
          {sectionTitle(`${labels.paymentsReceived} · ${payments.length}`)}
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>{labels.date}</th>
                  <th>{labels.ref}</th>
                  <th className="r">{labels.amount}</th>
                  <th>{labels.account}</th>
                  <th>{labels.note}</th>
                  {canEditPayments && <th />}
                </tr>
              </thead>
              <tbody>
                {payments.length === 0 ? (
                  <tr><td colSpan={canEditPayments ? 6 : 5} style={{ textAlign: 'center', color: 'var(--muted)', padding: 14 }}>{labels.noPayments}</td></tr>
                ) : payments.map(p => (
                  <tr key={p.id}>
                    <td className="mono" style={{ whiteSpace: 'nowrap' }}>{fmtDayTime(p.ts)}</td>
                    <td className="mono" style={{ whiteSpace: 'nowrap' }}>{p.ref}</td>
                    <td className="r">{num(p.credit, 'good')}</td>
                    <td style={{ color: 'var(--muted)' }}>{p.accountName || '—'}</td>
                    <td style={{ color: 'var(--muted)', minWidth: 140 }}>{p.description || '—'}</td>
                    {canEditPayments && (
                      <td>
                        <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                          {onEditRepayment && (
                            <button
                              className="rowBtn"
                              style={{ padding: '2px 8px', fontSize: 9, minHeight: 22 }}
                              onClick={() => onEditRepayment(p)}
                            >
                              {t('edit')}
                            </button>
                          )}
                          {onDeleteRepayment && (
                            <button
                              className="rowBtn"
                              style={{ padding: '2px 8px', fontSize: 9, minHeight: 22, color: 'var(--bad)' }}
                              onClick={() => onDeleteRepayment(p)}
                            >
                              {t('delete')}
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* The ledger itself — debit, credit, running balance */}
          {sectionTitle(labels.ledger)}
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>{labels.date}</th>
                  <th>{labels.ref}</th>
                  <th>{labels.description}</th>
                  <th className="r">{labels.debit}</th>
                  <th className="r">{labels.credit}</th>
                  <th className="r">{labels.balance}</th>
                </tr>
              </thead>
              <tbody>
                {statement.entries.length === 0 ? (
                  <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--muted)', padding: 14 }}>{labels.noEntries}</td></tr>
                ) : statement.entries.map(e => (
                  <tr key={e.id}>
                    <td className="mono" style={{ whiteSpace: 'nowrap' }}>{fmtDay(e.ts)}</td>
                    <td className="mono" style={{ whiteSpace: 'nowrap' }}>{e.ref}</td>
                    <td style={{ color: 'var(--muted)', minWidth: 160 }}>
                      {e.description || (e.kind === 'charge' ? labels.charge : labels.payment)}
                    </td>
                    <td className="r">{e.debit ? num(e.debit) : ''}</td>
                    <td className="r">{e.credit ? num(e.credit, 'good') : ''}</td>
                    <td className="r">{num(e.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Closing balance */}
          <div
            className="panel"
            style={{
              marginTop: 12, padding: '12px 14px', display: 'flex', justifyContent: 'space-between',
              alignItems: 'center', gap: 12, background: 'var(--panel2)',
              borderColor: statement.outstanding > 0 ? 'color-mix(in srgb, var(--bad) 35%, transparent)' : 'color-mix(in srgb, var(--good) 35%, transparent)',
            }}
          >
            <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.8px', textTransform: 'uppercase' }}>{labels.totalDue}</span>
            <span className="mono" style={{ fontSize: 18, fontWeight: 800, color: statement.outstanding > 0 ? 'var(--bad)' : 'var(--good)' }}>
              {formatMoney(statement.outstanding)} {cur}
            </span>
          </div>

          <div style={{ marginTop: 10, fontSize: 9, color: 'var(--muted)' }}>{labels.footerNote}</div>
        </div>
      </div>
    </div>
  );
}
