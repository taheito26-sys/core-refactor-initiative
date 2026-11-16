import { useMemo, type ReactNode } from 'react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { AccountHistory } from '@/features/stock/components/AccountHistory';
import { eventsFromLedger, eventsFromPublicStatement } from '@/features/stock/utils/accountHistory';
import type { PublicStatement } from '@/features/stock/components/PublicStatementReport';

type Lang = 'en' | 'ar';

function Shell({ open, onOpenChange, lang, title, description, children }: { open: boolean; onOpenChange: (open: boolean) => void; lang: Lang; title: string; description: string; children: ReactNode }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" dir={lang === 'ar' ? 'rtl' : 'ltr'} className="max-h-[92dvh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription className="sr-only">{description}</SheetDescription>
        </SheetHeader>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24, paddingTop: 8 }}>{open ? children : null}</div>
      </SheetContent>
    </Sheet>
  );
}

/**
 * What the buyer owes, as a bank statement: every order is a debit and every payment a credit, with the unpaid
 * amount before and after each, for any period or any past day. One statement per currency.
 */
export function LoanStatementSheet({ open, onOpenChange, lang, statements }: { open: boolean; onOpenChange: (open: boolean) => void; lang: Lang; statements: PublicStatement[] }) {
  const L = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  const rounding = L('Rounding', 'تقريب');
  const prepared = useMemo(() => statements.map(st => ({ st, events: eventsFromPublicStatement(st, rounding) })), [statements, rounding]);
  return (
    <Shell open={open} onOpenChange={onOpenChange} lang={lang} title={L('Account statement', 'كشف الحساب')} description={L('Every order and payment with the unpaid amount before and after it', 'كل طلب ودفعة مع المبلغ غير المسدد قبلها وبعدها')}>
      {prepared.map(({ st, events }) => (
        <AccountHistory key={st.currency} events={events} currency={st.currency} lang={lang} expectedBalance={st.outstanding} fileBase={`statement-${st.currency}`} />
      ))}
    </Shell>
  );
}

/** Money in and out of one of the person's own cash accounts, with the balance after every transaction. */
export function CashStatementSheet({ open, onOpenChange, lang, accountName, currency, ledger, typeLabel }: {
  open: boolean; onOpenChange: (open: boolean) => void; lang: Lang; accountName: string; currency: string;
  ledger: Array<{ id: string; ts: number | string; direction: 'in' | 'out'; amount: number | string; type: string; note: string | null }>;
  typeLabel?: (type: string) => string;
}) {
  const L = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  const events = useMemo(() => eventsFromLedger(ledger, typeLabel), [ledger, typeLabel]);
  return (
    <Shell open={open} onOpenChange={onOpenChange} lang={lang} title={accountName} description={L('Money in and out of this account with the balance after every transaction', 'الوارد والصادر في هذا الحساب مع الرصيد بعد كل حركة')}>
      <AccountHistory mode="cash" events={events} currency={currency} lang={lang} fileBase={`statement-${accountName}`} />
    </Shell>
  );
}
