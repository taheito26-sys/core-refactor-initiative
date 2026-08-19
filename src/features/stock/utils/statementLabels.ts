import type { TranslationKey } from '@/lib/i18n';
import type { StatementDocLabels } from './loanStatementExport';

type Translate = (key: TranslationKey) => string;

/**
 * The label set the statement builders need, resolved once per language.
 *
 * The builders take labels rather than calling `t` themselves so they stay pure
 * strings-in/strings-out — testable without a React tree or a language context.
 */
export function statementLabels(t: Translate): StatementDocLabels {
  return {
    documentTitle: t('stmtTitle'),
    issuedBy: t('stmtIssuedBy'),
    billTo: t('stmtBillTo'),
    phone: t('stmtPhone'),
    statementDate: t('stmtDate'),
    period: t('stmtPeriod'),
    currency: t('currency'),
    summary: t('stmtSummary'),
    totalLoaned: t('loanColLoaned'),
    totalRepaid: t('loanColRepaid'),
    outstanding: t('loanColOutstanding'),
    loanedOrders: t('stmtLoanedOrders'),
    ref: t('loanColRef'),
    date: t('loanColDate'),
    description: t('loanColDescription'),
    amount: t('loanColAmount'),
    paid: t('loanColPaid'),
    remaining: t('loanColRemaining'),
    status: t('loanColStatus'),
    age: t('stmtAgeDays'),
    days: t('loanDaysShort'),
    statusOpen: t('loanStatusOpen'),
    statusSettled: t('loanStatusClosed'),
    paymentsReceived: t('stmtPaymentsReceived'),
    account: t('loanColAccount'),
    note: t('loanNoteLabel'),
    ledger: t('stmtLedger'),
    charge: t('stmtCharge'),
    payment: t('stmtPayment'),
    debit: t('loanColDebit'),
    credit: t('loanColCredit'),
    balance: t('loanColBalance'),
    totalDue: t('stmtTotalDue'),
    aging: t('stmtAging'),
    agingCurrent: t('stmtAgingCurrent'),
    aging31: t('stmtAging31'),
    aging61: t('stmtAging61'),
    aging90: t('stmtAging90'),
    noPayments: t('loanNoPaymentsYet'),
    noEntries: t('stmtNoEntries'),
    generatedOn: t('stmtGeneratedOn'),
    footerNote: t('stmtFooterNote'),
    openingBalance: t('stmtOpeningBalance'),
    settlementSummary: t('stmtSettlementSummary'),
    settlementTotalLine: t('stmtSettlementTotalLine'),
    settlementPaidLine: t('stmtSettlementPaidLine'),
    settlementRemainingLine: t('stmtSettlementRemainingLine'),
    percentPaidSuffix: t('stmtPercentPaidSuffix'),
    against: t('stmtAgainst'),
    paymentsLog: t('stmtPaymentsLog'),
    allPayments: t('stmtAllPayments'),
    electronicNote: t('stmtElectronicNote'),
  };
}
