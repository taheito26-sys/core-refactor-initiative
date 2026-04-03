import { supabase } from '@/integrations/supabase/client';
import type { CashAccount, CashLedgerEntry } from './tracker-helpers';

// ── Type adapters (camelCase ↔ snake_case) ──────────────────────

function accountToRow(a: CashAccount, userId: string) {
  return {
    id:              a.id,
    user_id:         userId,
    name:            a.name,
    type:            a.type,
    currency:        a.currency,
    status:          a.status,
    bank_name:       a.bankName  ?? null,
    branch:          a.branch    ?? null,
    notes:           a.notes     ?? null,
    last_reconciled: a.lastReconciled ?? null,
    merchant_id:     a.merchantId ?? null,
    relationship_id: a.relationshipId ?? null,
    purpose:         a.purpose ?? 'custody',
    is_merchant_account: a.isMerchantAccount ?? false,
    created_at:      a.createdAt,
    updated_at:      new Date().toISOString(),
  };
}

function rowToAccount(row: Record<string, unknown>): CashAccount {
  return {
    id:             row.id as string,
    name:           row.name as string,
    type:           row.type as CashAccount['type'],
    currency:       row.currency as CashAccount['currency'],
    status:         row.status as 'active' | 'inactive',
    bankName:       (row.bank_name as string | null) ?? undefined,
    branch:         (row.branch   as string | null) ?? undefined,
    notes:          (row.notes    as string | null) ?? undefined,
    lastReconciled: (row.last_reconciled as number | null) ?? undefined,
    merchantId:     (row.merchant_id as string | null) ?? undefined,
    relationshipId: (row.relationship_id as string | null) ?? undefined,
    purpose:        (row.purpose as CashAccount['purpose']) ?? 'custody',
    isMerchantAccount: (row.is_merchant_account as boolean | null) ?? false,
    createdAt:      row.created_at as number,
  };
}

function entryToRow(e: CashLedgerEntry, userId: string) {
  return {
    id:                 e.id,
    user_id:            userId,
    account_id:         e.accountId,
    contra_account_id:  e.contraAccountId  ?? null,
    ts:                 e.ts,
    type:               e.type,
    direction:          e.direction,
    amount:             e.amount,
    currency:           e.currency,
    note:               e.note              ?? null,
    linked_entity_id:   e.linkedEntityId    ?? null,
    linked_entity_type: e.linkedEntityType  ?? null,
    merchant_id:        e.merchantId        ?? null,
    relationship_id:    e.relationshipId    ?? null,
    trade_id:           e.tradeId           ?? null,
    order_id:           e.orderId           ?? null,
    batch_id:           e.batchId           ?? null,
    settlement_id:      e.settlementId      ?? null,
  };
}

function rowToEntry(row: Record<string, unknown>): CashLedgerEntry {
  return {
    id:               row.id as string,
    ts:               row.ts as number,
    type:             row.type as CashLedgerEntry['type'],
    accountId:        row.account_id as string,
    contraAccountId:  (row.contra_account_id as string | null) ?? undefined,
    direction:        row.direction as 'in' | 'out',
    amount:           Number(row.amount),
    currency:         row.currency as CashLedgerEntry['currency'],
    note:             (row.note as string | null) ?? undefined,
    linkedEntityId:   (row.linked_entity_id   as string | null) ?? undefined,
    linkedEntityType: (row.linked_entity_type as CashLedgerEntry['linkedEntityType']) ?? undefined,
    merchantId:       (row.merchant_id as string | null) ?? undefined,
    relationshipId:   (row.relationship_id as string | null) ?? undefined,
    tradeId:          (row.trade_id as string | null) ?? undefined,
    orderId:          (row.order_id as string | null) ?? undefined,
    batchId:          (row.batch_id as string | null) ?? undefined,
    settlementId:     (row.settlement_id as string | null) ?? undefined,
  };
}

// ── Save (full upsert) ─────────────────────────────────────────

export async function saveCashToCloud(
  accounts: CashAccount[],
  ledger:   CashLedgerEntry[],
): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  const uid = user.id;

  // Upsert accounts
  if (accounts.length > 0) {
    const { error: accErr } = await (supabase
      .from('cash_accounts') as any)
      .upsert(accounts.map(a => accountToRow(a, uid)), { onConflict: 'id' });
    if (accErr) console.warn('[cash-sync] accounts upsert failed:', accErr.message);
  }

  // Upsert ledger entries
  if (ledger.length > 0) {
    const { error: ledErr } = await (supabase
      .from('cash_ledger') as any)
      .upsert(ledger.map(e => entryToRow(e, uid)), { onConflict: 'id' });
    if (ledErr) console.warn('[cash-sync] ledger upsert failed:', ledErr.message);
  }
}

// ── Load ───────────────────────────────────────────────────────

export async function loadCashFromCloud(): Promise<{
  accounts: CashAccount[];
  ledger:   CashLedgerEntry[];
} | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const [accResult, ledResult] = await Promise.all([
    (supabase
      .from('cash_accounts') as any)
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true }),
    (supabase
      .from('cash_ledger') as any)
      .select('*')
      .eq('user_id', user.id)
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

  return {
    accounts: (accResult.data ?? []).map((r: any) => rowToAccount(r as Record<string,unknown>)),
    ledger:   (ledResult.data ?? []).map((r: any) => rowToEntry(r as Record<string,unknown>)),
  };
}

// ── Delete (for deactivated accounts cleanup — optional) ───────

export async function deleteCashAccountFromCloud(accountId: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  await (supabase
    .from('cash_accounts') as any)
    .delete()
    .eq('id', accountId)
    .eq('user_id', user.id);
}
