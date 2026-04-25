import { supabase } from '@/integrations/supabase/client';
import type { CashAccount, CashLedgerEntry } from './tracker-helpers';
import { isTrackerClearInProgress, isTrackerDataCleared } from './tracker-backup';

const DISABLE_CASH_CLOUD_SYNC = false;

/**
 * Flips to true the first time loadCashFromCloud successfully reaches the
 * cloud this session. Reconcile-deletes in saveCashToCloud are gated on
 * this flag — an empty local state BEFORE cloud has loaded means "we don't
 * know what's in cloud yet", NOT "the user wants to clear everything".
 * Without this gate, a debounced auto-save firing during the post-mount
 * race window wipes every cash row the user has.
 */
let _cashCloudLoadedThisSession = false;

const LEGACY_LEDGER_TYPE_MAP: Record<CashLedgerEntry['type'], string> = {
  opening: 'opening',
  deposit: 'deposit',
  sale_deposit: 'deposit',
  withdrawal: 'withdrawal',
  transfer_in: 'transfer_in',
  transfer_out: 'transfer_out',
  stock_purchase: 'stock_purchase',
  stock_refund: 'stock_refund',
  stock_edit_adjust: 'stock_edit_adjust',
  reconcile: 'reconcile',
  merchant_funding_out: 'transfer_out',
  merchant_funding_return: 'transfer_in',
  merchant_sale_proceeds: 'deposit',
  merchant_settlement_in: 'transfer_in',
  merchant_settlement_out: 'transfer_out',
  merchant_fee: 'withdrawal',
  merchant_adjustment: 'reconcile',
};

function normalizeLegacyAccountType(type: CashAccount['type']): 'hand' | 'bank' | 'vault' {
  return type === 'merchant_custody' ? 'vault' : type;
}

// Type adapters (camelCase <-> snake_case)

function accountToRow(a: CashAccount, userId: string) {
  return {
    id: a.id,
    user_id: userId,
    name: a.name,
    type: normalizeLegacyAccountType(a.type),
    currency: a.currency,
    status: a.status,
    bank_name: a.bankName ?? null,
    branch: a.branch ?? null,
    notes: a.notes ?? null,
    last_reconciled: a.lastReconciled ?? null,
    is_merchant_account: a.isMerchantAccount ?? a.type === 'merchant_custody',
    created_at: a.createdAt,
    updated_at: new Date().toISOString(),
  };
}

function rowToAccount(row: Record<string, unknown>): CashAccount {
  const isMerchantAccount = (row.is_merchant_account as boolean | null) ?? false;

  return {
    id: row.id as string,
    name: row.name as string,
    type: isMerchantAccount ? 'merchant_custody' : (row.type as CashAccount['type']),
    currency: row.currency as CashAccount['currency'],
    status: row.status as 'active' | 'inactive',
    bankName: (row.bank_name as string | null) ?? undefined,
    branch: (row.branch as string | null) ?? undefined,
    notes: (row.notes as string | null) ?? undefined,
    lastReconciled: (row.last_reconciled as number | null) ?? undefined,
    merchantId: (row.merchant_id as string | null) ?? undefined,
    relationshipId: (row.relationship_id as string | null) ?? undefined,
    purpose: (row.purpose as CashAccount['purpose']) ?? 'custody',
    isMerchantAccount,
    createdAt: row.created_at as number,
  };
}

function entryToRow(e: CashLedgerEntry, userId: string) {
  const normalizedType = LEGACY_LEDGER_TYPE_MAP[e.type] ?? e.type;
  const linkedEntityType =
    e.linkedEntityType === 'batch' || e.linkedEntityType === 'trade' ? e.linkedEntityType : null;
  return {
    id: e.id,
    user_id: userId,
    account_id: e.accountId,
    contra_account_id: e.contraAccountId ?? null,
    ts: e.ts,
    type: normalizedType,
    direction: e.direction,
    amount: e.amount,
    currency: e.currency,
    note: e.note ?? null,
    linked_entity_id: linkedEntityType ? e.linkedEntityId ?? null : null,
    linked_entity_type: linkedEntityType,
    batch_id: e.batchId ?? null,
  };
}

function rowToEntry(row: Record<string, unknown>): CashLedgerEntry {
  return {
    id: row.id as string,
    ts: row.ts as number,
    type: row.type as CashLedgerEntry['type'],
    accountId: row.account_id as string,
    contraAccountId: (row.contra_account_id as string | null) ?? undefined,
    direction: row.direction as 'in' | 'out',
    amount: Number(row.amount),
    currency: row.currency as CashLedgerEntry['currency'],
    note: (row.note as string | null) ?? undefined,
    linkedEntityId: (row.linked_entity_id as string | null) ?? undefined,
    linkedEntityType: (row.linked_entity_type as CashLedgerEntry['linkedEntityType']) ?? undefined,
    merchantId: (row.merchant_id as string | null) ?? undefined,
    relationshipId: (row.relationship_id as string | null) ?? undefined,
    tradeId: (row.trade_id as string | null) ?? undefined,
    orderId: (row.order_id as string | null) ?? undefined,
    batchId: (row.batch_id as string | null) ?? undefined,
    settlementId: (row.settlement_id as string | null) ?? undefined,
  };
}

// Save (full upsert)

export async function saveCashToCloud(
  accounts: CashAccount[],
  ledger: CashLedgerEntry[],
): Promise<void> {
  if (DISABLE_CASH_CLOUD_SYNC) return;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const uid = user.id;

  if (accounts.length > 0) {
    const { error: accErr } = await (supabase
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from('cash_accounts') as any)
      .upsert(accounts.map((a) => accountToRow(a, uid)), { onConflict: 'id' });
    if (accErr) {
      console.warn('[cash-sync] accounts upsert failed:', accErr.message);
    }
  }

  if (ledger.length > 0) {
    const { error: ledErr } = await (supabase
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from('cash_ledger') as any)
      .upsert(ledger.map((e) => entryToRow(e, uid)), { onConflict: 'id' });
    if (ledErr) {
      console.warn('[cash-sync] ledger upsert failed:', ledErr.message);
    }
  }

  // Full reconcile: delete this user's rows whose ids are NOT in the local
  // set. Without this, a removed/cleared cash entry stays in the cloud and
  // reappears on the next merchant-wide load.
  //
  // GATED on _cashCloudLoadedThisSession: an empty local state before cloud
  // has loaded means "we haven't observed cloud yet" — running the reconcile
  // delete in that window wipes every cash row for this user. We only know
  // the local set is intentional once loadCashFromCloud has succeeded once.
  if (!_cashCloudLoadedThisSession) return;

  const accountIds = accounts.map((a) => a.id).filter(Boolean);
  const ledgerIds = ledger.map((e) => e.id).filter(Boolean);

  const accDel = (supabase
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('cash_accounts') as any)
    .delete()
    .eq('user_id', uid);
  const ledDel = (supabase
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('cash_ledger') as any)
    .delete()
    .eq('user_id', uid);

  const [accDelRes, ledDelRes] = await Promise.all([
    accountIds.length > 0 ? accDel.not('id', 'in', `(${accountIds.map((id) => `"${id}"`).join(',')})`) : accDel,
    ledgerIds.length > 0 ? ledDel.not('id', 'in', `(${ledgerIds.map((id) => `"${id}"`).join(',')})`) : ledDel,
  ]);

  if (accDelRes.error) {
    console.warn('[cash-sync] accounts reconcile delete failed:', accDelRes.error.message);
  }
  if (ledDelRes.error) {
    console.warn('[cash-sync] ledger reconcile delete failed:', ledDelRes.error.message);
  }
}

/** Delete all cash rows for the current user. */
export async function clearCashStateFromCloud(): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const uid = user.id;
  const [accResult, ledResult] = await Promise.all([
    (supabase
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from('cash_accounts') as any)
      .delete()
      .eq('user_id', uid),
    (supabase
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from('cash_ledger') as any)
      .delete()
      .eq('user_id', uid),
  ]);

  if (accResult.error) {
    console.warn('[cash-sync] clear cash accounts failed:', accResult.error.message);
  }
  if (ledResult.error) {
    console.warn('[cash-sync] clear cash ledger failed:', ledResult.error.message);
  }
}

// Load

export async function loadCashFromCloud(): Promise<{
  accounts: CashAccount[];
  ledger: CashLedgerEntry[];
} | null> {
  if (DISABLE_CASH_CLOUD_SYNC) return null;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  // Resolve all user IDs in the same merchant group so cash written by any
  // team member (e.g. desktop user) is visible on every device.
  let userIds: string[] = [user.id];
  try {
    const { data: myProfile } = await (supabase
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from('merchant_profiles') as any)
      .select('merchant_id')
      .eq('user_id', user.id)
      .maybeSingle();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const merchantId = (myProfile as any)?.merchant_id as string | undefined;
    if (merchantId) {
      const { data: members } = await (supabase
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .from('merchant_profiles') as any)
        .select('user_id')
        .eq('merchant_id', merchantId);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ids = (members || []).map((m: any) => m.user_id).filter(Boolean) as string[];
      if (ids.length > 0) userIds = Array.from(new Set(ids));
    }
  } catch {
    // Non-critical — fall back to own user only
  }

  const [accResult, ledResult] = await Promise.all([
    (supabase
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from('cash_accounts') as any)
      .select('*')
      .in('user_id', userIds)
      .order('created_at', { ascending: true }),
    (supabase
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from('cash_ledger') as any)
      .select('*')
      .in('user_id', userIds)
      .order('ts', { ascending: true }),
  ]);

  if (accResult.error) {
    console.warn('[cash-sync] load accounts failed:', accResult.error.message);
    return null;
  }
  if (ledResult.error) {
    console.warn('[cash-sync] load ledger failed:', ledResult.error.message);
    return null;
  }

  // Cloud has been observed — reconcile-delete is now safe.
  _cashCloudLoadedThisSession = true;

  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    accounts: (accResult.data ?? []).map((r: any) => rowToAccount(r as Record<string, unknown>)),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ledger: (ledResult.data ?? []).map((r: any) => rowToEntry(r as Record<string, unknown>)),
  };
}

// Delete (for deactivated accounts cleanup - optional)

export async function deleteCashAccountFromCloud(accountId: string): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  await (supabase
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('cash_accounts') as any)
    .delete()
    .eq('id', accountId)
    .eq('user_id', user.id);
}

/** Delete specific ledger entries by ID from the cloud */
export async function deleteLedgerEntriesFromCloud(entryIds: string[]): Promise<void> {
  if (entryIds.length === 0) return;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  const { error } = await (supabase
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('cash_ledger') as any)
    .delete()
    .in('id', entryIds)
    .eq('user_id', user.id);
  if (error) console.warn('[cash-sync] deleteLedgerEntriesFromCloud failed:', error.message);
}

/** Delete all ledger entries for a given account ID from the cloud */
export async function deleteCashAccountLedgerFromCloud(accountId: string): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  const { error } = await (supabase
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .from('cash_ledger') as any)
    .delete()
    .eq('account_id', accountId)
    .eq('user_id', user.id);
  if (error) console.warn('[cash-sync] deleteCashAccountLedgerFromCloud failed:', error.message);
}
