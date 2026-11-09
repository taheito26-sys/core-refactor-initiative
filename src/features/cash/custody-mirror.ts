import { getAccountBalance, type CashAccount, type CashLedgerEntry } from '@/lib/tracker-helpers';

/** One row of custody_mirror_status(): who holds the cash for a custody account of mine. */
export interface CustodyMirrorStatus {
  account_id: string;
  role: 'holder' | 'mirror';
  source_account_id: string;
  source_balance: number | string;
}

const cents = (n: number) => Math.round(n * 100);

/**
 * Custody accounts are one ledger per merchant. The holder's account is the source of truth;
 * the other side's account must always show the same balance. For each mirror account this
 * returns the one adjusting entry that brings its balance to the holder's.
 *
 * The id is derived from the target and current balances, so two devices of the same merchant
 * planning from the same state create the same entry and it is stored once, and a state that
 * already matches plans nothing.
 */
export function planCustodyMirror(
  accounts: CashAccount[],
  ledger: CashLedgerEntry[],
  statuses: CustodyMirrorStatus[],
  now: number,
): CashLedgerEntry[] {
  const known = new Set(ledger.map((e) => e.id));
  const planned: CashLedgerEntry[] = [];

  for (const status of statuses) {
    if (status.role !== 'mirror') continue;
    const account = accounts.find((a) => a.id === status.account_id);
    if (!account || account.type !== 'merchant_custody' || account.status !== 'active') continue;

    const target = Number(status.source_balance);
    if (!Number.isFinite(target)) continue;
    const current = getAccountBalance(account.id, ledger);
    const delta = Math.round((target - current) * 100) / 100;
    if (Math.abs(delta) < 0.005) continue;

    const id = `cmirror-${account.id}-${cents(target)}-${cents(current)}`;
    if (known.has(id)) continue;
    planned.push({
      id,
      ts: now,
      type: 'merchant_adjustment',
      accountId: account.id,
      direction: delta > 0 ? 'in' : 'out',
      amount: Math.abs(delta),
      currency: account.currency,
      note: `Custody sync: holder's balance is ${target.toLocaleString('en-US', { maximumFractionDigits: 2 })}`,
      merchantId: account.merchantId,
      relationshipId: account.relationshipId,
    });
  }
  return planned;
}
