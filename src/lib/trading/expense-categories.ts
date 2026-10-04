import type { CashLedgerEntry } from '../tracker-helpers';

// ─── Where cash that left the business went ───
//
// Money that leaves a cash account other than to buy stock, lend, or move
// between accounts is a withdrawal or a cash adjustment. Business expenses
// reduce the profit of the business; personal money (the owner's draws and
// private spending) does not, and is kept apart so business results stay clean.

export type ExpenseGroup = 'business' | 'personal';

export interface ExpenseCategory {
  key: string;
  group: ExpenseGroup;
}

export const EXPENSE_CATEGORIES: ExpenseCategory[] = [
  { key: 'rent', group: 'business' },
  { key: 'salaries', group: 'business' },
  { key: 'fees', group: 'business' },
  { key: 'transport', group: 'business' },
  { key: 'communication', group: 'business' },
  { key: 'loss', group: 'business' },
  { key: 'business_other', group: 'business' },
  { key: 'owner_draw', group: 'personal' },
  { key: 'personal_spending', group: 'personal' },
];

const BY_KEY = new Map(EXPENSE_CATEGORIES.map(c => [c.key, c]));

export function expenseCategoryOf(key: string | undefined): ExpenseCategory | undefined {
  return key ? BY_KEY.get(key) : undefined;
}

/** Outgoing cash that is spending rather than a purchase, loan or transfer. */
export function isExpenseCandidate(e: Pick<CashLedgerEntry, 'direction' | 'type'>): boolean {
  return e.direction === 'out' && (e.type === 'withdrawal' || e.type === 'reconcile' || e.type === 'merchant_fee');
}

/** A withdrawal that has not been given a category yet. */
export function isUncategorised(e: Pick<CashLedgerEntry, 'direction' | 'type' | 'expenseCategory'>): boolean {
  return isExpenseCandidate(e) && !expenseCategoryOf(e.expenseCategory);
}
