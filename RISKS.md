# Tracker Risk & Issue Register

**Generated:** 2026-04-05
**Scope:** `src/` — full codebase assessment
**Stack:** React 18 · Vite 5 · TanStack Query v5 · Zustand v5 · Supabase v2

---

## Severity Index

| Symbol | Meaning |
|--------|---------|
| 🔴 CRITICAL | Data corruption or broken core workflow — fix immediately |
| 🟠 HIGH | Significant bug, security risk, or integrity gap |
| 🟡 MEDIUM | Missing feature or degraded UX |
| 🔵 LOW | Enhancement or polish |

---

## 1. Critical Bugs

### 🔴 1.1 Settlement Reversal Pool Balance Calculation
**File:** `src/hooks/useSettlements.ts`

The reversal logic re-uses `pool_balance_after` from the original entry as the base, then adds or subtracts the amount again — creating a double-offset. The reversal entry needs the *pre-transaction* balance (either fetched from the prior ledger entry or stored as `pool_balance_before`). Under current logic, payout reversals produce no pool change at all.

**Impact:** Pool balances become permanently incorrect after any settlement rejection.

---

### 🔴 1.2 No Atomic Transactions on Multi-Step Mutations
**Files:** `src/hooks/useSettlements.ts`, `src/hooks/useDealCapital.ts`

Settlement rejection runs 5 sequential Supabase calls with no rollback:
1. Update settlement status
2. Fetch ledger entries
3. Insert reversal entries (loop)
4. Reopen period
5. Clear `settlement_id`

Any network failure mid-sequence leaves corrupted partial state. Supabase RPC functions support atomic multi-statement operations and should be used here.

**Impact:** Partial rejections leave periods closed with no reversals, or reversals present with period still showing settled.

---

### 🔴 1.3 Withdrawal Pre-Settles Period Before Merchant Approval
**File:** `src/hooks/useDealCapital.ts` (`useWithdrawFromPool`)

`useWithdrawFromPool` sets `settlement_periods.status = 'settled'` immediately on creation, then creates a `merchant_settlements` record as `'pending'`. The period is already closed before the merchant approves anything. This is inverted logic — the merchant sees a pending settlement for a period that is already resolved and cannot meaningfully approve or reject it.

**Impact:** Withdrawal approval workflow is non-functional. Merchants cannot block invalid withdrawals.

---

## 2. High Bugs

### 🔴 2.0 Sale Cash Deposit Not Reflected in Cash Management
**Files:** `src/features/orders/utils/cashDeposit.ts`, `src/features/stock/components/CashManagement.tsx`

`applyOrderCashDeposit` has two code paths:

- **Path A (cashAccounts exist):** Writes a `CashLedgerEntry` with `type: 'sale_deposit'` into `state.cashLedger`. `CashManagement` reads `state.cashLedger` — deposit appears correctly. ✅
- **Path B (no cashAccounts / fallback):** Writes to the legacy `state.cashHistory` array and increments `state.cashQAR` directly. `CashManagement` does **not** read `cashHistory` — the deposit is invisible in the UI. ❌

Any user who has not configured cash accounts (or whose account list is empty) will have sale proceeds silently written to `cashHistory` only. `cashQAR` increments numerically but no ledger entry exists — Cash Management shows no record of the deposit.

**Impact:** Sale cash deposits disappear from Cash Management for users without configured cash accounts. The money appears in the total balance only, with no audit trail and no visibility into which sale it came from.

---

### 🟠 2.1 Silent Cloud Sync Failure
**File:** `src/lib/useTrackerState.ts`

```typescript
}).catch(() => {});  // swallows all cloud load errors
```

Cloud sync failures are silently ignored. Users assume their data loaded when it did not, leading to stale or empty state with no indication.

---

### 🟠 2.2 `settlement_id` Linkage Lost on Re-Settlement
**Files:** `src/hooks/useSettlements.ts`, `src/pages/OrdersPage.tsx`

When a settlement is rejected and the period is reopened, `settlement_id` is cleared. No mechanism ensures the new `settlement_id` is written back when the period is settled again. Second-pass settlements silently lose their period linkage.

---

## 3. Security Risks

### 🟠 3.1 Pervasive `as any` Type Casts
**Files:** `useSettlements.ts`, `useDealCapital.ts`, `useBalanceLedger.ts`

Supabase response shapes are cast with `as any` throughout instead of typed generics. TypeScript cannot catch field name mistakes, schema drift, or mismatched response shapes. Should be replaced with typed query results: `supabase.from('table').select('*').returns<MyType[]>()`.

---

### 🟠 3.2 Unguarded `userId!` Non-Null Assertions
**Files:** `useSettlements.ts`, `useDealCapital.ts`

```typescript
initiated_by: userId!
settled_by: userId!
```

If auth context goes stale or a user logs out mid-operation, these assertions produce unhandled runtime errors. Null checks with graceful error messages are required.

---

### 🟠 3.3 Client-Side Timestamps on Ledger Entries
**File:** `src/hooks/useDealCapital.ts`

`const now = new Date()` is used for `period_start`, `resolved_at`, and similar fields. Client clocks can have skew or be manipulated. All timestamps for financial ledger entries should be server-generated via Supabase's `now()` (using `default: now()` columns or RPC functions).

---

## 4. Data Integrity Risks

### 🔴 4.1 Reversal Entries Have No Back-Reference
**File:** `src/hooks/useSettlements.ts`

Reversal entries in `deal_capital_ledger` carry no `original_entry_id`. It is impossible to:
- Trace which entry was reversed
- Detect duplicate reversals
- Validate that the reversal amount exactly offsets the original

Financial audits and reconciliation are impossible without this link.

---

### 🟠 4.2 Running Balance Computed at Query Time, Not Persisted
**File:** `src/hooks/useBalanceLedger.ts`

`running_balance` is calculated in-memory at query time from ordered results. If entries are ever inserted out of order (possible during concurrent or failed mutations), the displayed balance history changes. There is no single source of truth for what the pool balance was at any given point.

---

### 🟠 4.3 Floating-Point Precision Loss on Currency Amounts
**Files:** `useDealCapital.ts`, `useBalanceLedger.ts`

```typescript
amount: Number(tx.amount)
cost_basis: Number(tx.cost_basis)
```

Raw `Number()` conversion loses precision on currency values. The app's existing `num()` helper (which validates `isFinite`) should be used, and amounts should be rounded to the currency's decimal precision before persisting.

---

### 🟠 4.4 No Protection Against Double-Reversal
**File:** `src/hooks/useSettlements.ts`

Nothing prevents a settlement from being rejected twice. The idempotency guard only checks `status !== 'pending'`, but if two concurrent requests arrive simultaneously, both can pass the check and both will insert reversal entries, doubling the reversal amounts.

---

## 5. Missing Business Logic

### 🟠 5.1 No Settlement Amount Reconciliation
The `amount` field on `merchant_settlements` is user-entered. No validation checks that it matches the sum of `deal_capital_ledger` payout entries for the corresponding period. A merchant can approve an incorrect amount silently.

---

### 🟠 5.2 No Capital Pool Upper Bound Validation
**File:** `src/hooks/useDealCapital.ts`

Reinvest operations do not validate that the reinvested amount is ≤ the deal's available working capital. It is possible to reinvest more capital than the deal holds, producing a negative effective balance.

---

### 🟠 5.3 Withdrawal Approval Has No UI Flow
There is no UI flow connecting a partner's withdrawal request to a merchant approval action. Partners see the ledger deduction; merchants see a pending settlement — but there is no "approve this withdrawal" button or modal tied to the specific settlement record. The workflow exists in code but is not surfaced in the interface.

---

### 🟡 5.4 `this_month` / `last_month` Ranges Not Exposed
**Files:** `src/lib/tracker-helpers.ts`, `src/lib/theme-context.tsx`, `src/pages/SettingsPage.tsx`

`inRange()` in `tracker-helpers.ts` handles `'this_month'` and `'last_month'` correctly. However, `AppSettings.range` type union only allows `today | 7d | 30d | all`, and the Settings page range selector never lists them. These ranges are dead code with real business value (calendar-month profit view).

---

### 🟡 5.5 Deal-Term Snapshot Not Stored on Settlement
If profit-split percentages or fee structures change on a deal after a settlement is created but before it is approved, the approved settlement will use the new terms retroactively. There is no snapshot of deal terms at the time of settlement creation.

---

## 6. Performance Issues

### 🟡 6.1 Full Ledger History Loaded on Every Query
**File:** `src/hooks/useDealCapital.ts`

```typescript
.select('*').eq('deal_id', dealId)  // no limit, no date filter
```

For deals with large ledger histories, this query will grow unbounded. Needs pagination or a date-range filter with a running-balance starting point.

---

### 🔵 6.2 Theme DOM Repaints on Every Draft Change
**File:** `src/lib/theme-context.tsx`

`applyThemeToDOM()` updates 50+ CSS custom properties in a `useEffect` that fires on every draft state change. During rapid settings interaction, this causes excessive style recalculation. Should be debounced or triggered only on save.

---

## 7. UX / State Management Gaps

### 🟠 7.1 No Loading State During Mutations
`useWithdrawFromPool`, `useReinvestProfit`, and `useApproveSettlement` do not propagate `isPending` to the UI. Users can double-submit during slow network responses, triggering duplicate ledger entries.

---

### 🟡 7.2 Settings Auto-Save Confusion
**File:** `src/lib/theme-context.tsx`

Settings auto-save after an 800ms debounce. The explicit "Save" and "Discard" buttons are misleading — "Discard" only works if pressed before the timer fires. Users making quick edits get them silently persisted with no confirmation.

---

### 🟡 7.3 Withdrawal Input Missing Basic Validation
**File:** `src/features/merchants/components/CapitalPoolPanel.tsx`

Withdrawal input only checks `amt > pool`. Missing checks:
- `amt <= 0`
- Non-numeric or empty input
- Excessive decimal precision

Invalid values will produce malformed ledger entries.

---

### 🟡 7.4 Settlement Rejection Error Reporting is Opaque
The rejection mutation runs 5+ steps. A single `onError` toast covers all failure points. Users cannot determine whether the status update succeeded but reversals failed, or whether the period was reopened without reversal entries being created.

---

## 8. Enhancement Backlog

| # | Enhancement | Priority | Rationale |
|---|-------------|----------|-----------|
| E1 | Move multi-step settlement mutations to Supabase RPC for atomicity | 🔴 Critical | Eliminates partial-state corruption |
| E2 | Add `original_entry_id` to `deal_capital_ledger` | 🟠 High | Enables reversal traceability and audit |
| E3 | Add `pool_balance_before` column to ledger entries | 🟠 High | Makes reversal math self-contained and correct |
| E4 | Expose `this_month` / `last_month` in Settings range selector | 🟠 High | Business value already implemented, just hidden |
| E5 | Server-side timestamp generation for all ledger entries | 🟠 High | Prevents clock skew in financial records |
| E6 | Idempotency keys on settlement mutations | 🟠 High | Prevents duplicate entries from concurrent/retry requests |
| E7 | Settlement amount reconciliation vs ledger payout sum | 🟡 Medium | Catches amount discrepancies before approval |
| E8 | Capital pool upper bound validation on reinvest | 🟡 Medium | Prevents over-investment beyond deal capital |
| E9 | Paginate ledger queries for large deal histories | 🟡 Medium | Performance at scale |
| E10 | Replace all `as any` with typed Supabase generics | 🟡 Medium | Type safety, catches schema drift at compile time |
| E11 | `isPending` guards on all mutation UIs | 🟡 Medium | Prevents double-submit |
| E12 | Per-step error reporting in settlement rejection flow | 🟡 Medium | Users understand what succeeded vs failed |
| E13 | Deal-term snapshot stored on settlement creation | 🟡 Medium | Prevents retroactive term changes affecting pending settlements |
| E14 | Debounce theme DOM updates | 🔵 Low | Reduce repaints during settings interaction |
| E15 | Surface withdrawal approval UI flow end-to-end | 🟠 High | Withdrawal workflow exists in code but is unreachable in UI |
| E16 | Remove `cashHistory` fallback path in `applyOrderCashDeposit` — always write to `cashLedger` | 🔴 Critical | Legacy path makes sale deposits invisible in Cash Management |

---

## Immediate Action Items

The following items risk live data corruption if left unaddressed:

1. **Fix sale cash deposit not appearing in Cash Management** — remove `cashHistory` fallback in `applyOrderCashDeposit`; always write to `cashLedger` so the deposit is visible
2. **Fix pool balance reversal calculation** — current logic produces wrong `pool_balance_after` for payout reversals
2. **Wrap settlement rejection in an RPC function** — eliminates partial-state corruption risk
3. **Fix withdrawal workflow** — period must not be pre-settled before merchant approval
4. **Add `original_entry_id` to reversals** — without this, financial reconciliation is impossible
5. **Guard against double-reversal** — concurrent rejection requests bypass idempotency check

---

*This document reflects codebase state as of 2026-04-05. Re-assess after each major feature change to settlement or capital ledger logic.*
