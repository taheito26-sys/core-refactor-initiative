import { describe, it, expect } from 'vitest';
import {
  resolveStatementName,
  buildMonthlyStatementHtml,
  monthlyStatementFileBase,
  type MonthlyStatementData,
} from '@/features/stock/utils/monthlyStatementExport';

// The exported statement's body is Arabic by design, but the buyer's name is
// the one piece a reader matches against their own records — so it follows the
// language they are working in rather than being fixed to whichever spelling
// happens to sit in the legacy `name` field.

const statement = (over: Partial<MonthlyStatementData> = {}): MonthlyStatementData => ({
  customerName: 'Mohamed Al-Damrawy',
  customerNameEn: 'Mohamed Al-Damrawy',
  customerNameAr: 'محمد الدمراوي',
  currency: 'QAR',
  totalLoaned: 100,
  totalRepaid: 40,
  outstanding: 60,
  previousBalance: 0,
  totalLoanedAllTime: 100,
  totalRepaidAllTime: 40,
  issueDate: '2026-09-14',
  month: '2026-09',
  payments: [],
  binanceOrders: [],
  ...over,
});

describe('resolveStatementName', () => {
  it('prints the Arabic spelling for an Arabic reader', () => {
    expect(resolveStatementName(statement(), 'ar')).toBe('محمد الدمراوي');
  });

  it('prints the English spelling for an English reader', () => {
    expect(resolveStatementName(statement(), 'en')).toBe('Mohamed Al-Damrawy');
  });

  it('falls back to the other language when only one spelling exists', () => {
    const arabicOnly = statement({ customerNameEn: null, customerNameAr: 'محمد الدمراوي' });
    expect(resolveStatementName(arabicOnly, 'en')).toBe('محمد الدمراوي');

    const englishOnly = statement({ customerNameEn: 'Mohamed Al-Damrawy', customerNameAr: null });
    expect(resolveStatementName(englishOnly, 'ar')).toBe('Mohamed Al-Damrawy');
  });

  it('falls back to the legacy single name when neither is recorded', () => {
    const legacy = statement({ customerNameEn: null, customerNameAr: null, customerName: 'Legacy Buyer' });
    expect(resolveStatementName(legacy, 'ar')).toBe('Legacy Buyer');
    expect(resolveStatementName(legacy, 'en')).toBe('Legacy Buyer');
  });

  it('survives an edge function that has not been redeployed yet', () => {
    // The per-language fields are simply absent from an older payload.
    const older = statement();
    delete (older as Partial<MonthlyStatementData>).customerNameEn;
    delete (older as Partial<MonthlyStatementData>).customerNameAr;
    expect(resolveStatementName(older, 'ar')).toBe('Mohamed Al-Damrawy');
  });
});

describe('rendered statement', () => {
  it('puts the Arabic name in the document when the UI is Arabic', () => {
    const html = buildMonthlyStatementHtml(statement(), { lang: 'ar' });
    expect(html).toContain('محمد الدمراوي');
    expect(html).not.toContain('Mohamed Al-Damrawy');
  });

  it('puts the English name in the document when the UI is English', () => {
    const html = buildMonthlyStatementHtml(statement(), { lang: 'en' });
    expect(html).toContain('Mohamed Al-Damrawy');
    expect(html).not.toContain('محمد الدمراوي');
  });

  it('defaults to Arabic when no language is passed', () => {
    expect(buildMonthlyStatementHtml(statement())).toContain('محمد الدمراوي');
  });
});

describe('download filename', () => {
  it('follows the reader language too', () => {
    expect(monthlyStatementFileBase(statement(), 'en')).toMatch(/^mohamed-al-damrawy-statement-2026-09-\d{6}$/);
    expect(monthlyStatementFileBase(statement(), 'ar')).toMatch(/^محمد-الدمراوي-statement-2026-09-\d{6}$/);
  });
});
