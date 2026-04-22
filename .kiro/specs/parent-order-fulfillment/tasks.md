# Implementation Plan: Parent Order Fulfillment with Child Executions

## Overview

Implement the parent order fulfillment feature incrementally: database schema first, then pure aggregation logic, then validation logic, then the customer portal UI (expand/collapse + cash account acceptance), then the mobile install prompt. Each phase builds on the previous and is wired together at the end.

## Tasks

- [ ] 1. Database schema — `order_executions` table and `customer_orders` extension
  - Create a Supabase migration that adds the `order_executions` table with all required columns: `id`, `parent_order_id`, `sequence_number`, `sold_qar_amount`, `fx_rate_qar_to_egp`, `egp_received_amount` (generated column), `market_type`, `cash_account_id`, `status`, `executed_at`, `created_by`, `created_at`, `updated_at`
  - Add CHECK constraints: `sold_qar_amount > 0`, `fx_rate_qar_to_egp > 0`
  - Add FK from `order_executions.parent_order_id` → `customer_orders.id`
  - Add `market_type` CHECK constraint: `('instapay_v1', 'p2p', 'bank', 'manual')`
  - Add `status` CHECK constraint: `('completed', 'pending', 'cancelled', 'failed')`
  - Add a DB trigger or sequence to auto-assign `sequence_number` scoped per `parent_order_id`
  - Add nullable column `destination_cash_account_id` to `customer_orders` (FK → `cash_accounts.id`) without altering any existing columns or constraints
  - Add a DB trigger or RPC guard that holds a row-level lock on the parent order during execution inserts to enforce overfill prevention at the database layer
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10, 4.3, 4.4, 7.11, 11.7_

- [ ] 2. Core types and interfaces
  - [ ] 2.1 Create `src/features/parent-order-fulfillment/types.ts` with all TypeScript interfaces and union types from the design: `ExecutionStatus`, `MarketType`, `OrderExecution`, `FulfillmentStatus`, `ParentOrderSummary`, `OrderAcceptancePayload`, `CashAccountValidationResult`, `InstallPromptState`, `MobileInstallContext`
    - _Requirements: 1.1, 1.7, 1.8, 3.1–3.14, 7.4–7.9, 9.1–9.9, 10.1–10.7_

- [ ] 3. Implement `computeParentSummary`
  - [ ] 3.1 Create `src/features/parent-order-fulfillment/aggregation.ts` and implement `computeParentSummary(parentQarAmount, executions)` following the formal specification in the design
    - Filter to `status === 'completed'` executions only
    - Compute `fulfilled_qar`, `remaining_qar`, `total_egp_received`, `fill_count`, `progress_percent`
    - Compute `weighted_avg_fx` as `total_egp_received / fulfilled_qar` (never a simple average); return `null` when `fill_count === 0`
    - Derive `fulfillment_status` via the three-way mapping
    - Return `executions` array ordered by `sequence_number` ascending
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11, 3.12, 3.13, 3.14, 5.1, 5.2, 5.3, 5.4_

  - [ ]* 3.2 Write property tests for `computeParentSummary` using `fast-check`
    - **Property 1: `weightedAvgFx` is always between `min(childRate)` and `max(childRate)` for any non-empty set of completed executions**
    - **Validates: Requirements 3.6, 3.8**
    - **Property 2: `fulfilled_qar + remaining_qar === parent_qar_amount` for any execution set**
    - **Validates: Requirements 3.1, 3.2, 3.12**
    - **Property 3: `progress_percent` is always in `[0, 100]`**
    - **Validates: Requirements 3.5, 3.13**
    - **Property 5: `computeParentSummary` with no completed executions always returns `weighted_avg_fx = null`**
    - **Validates: Requirements 3.7**

  - [ ]* 3.3 Write unit tests for `computeParentSummary`
    - Table-driven tests: unfulfilled (0 completed), partial, fully fulfilled, single execution, many executions
    - Canonical scenario: 50,000 QAR across three executions → `weighted_avg_fx = 13.385`, `fulfillment_status = 'fully_fulfilled'`, `remaining_qar = 0`, `progress_percent = 100`
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

- [ ] 4. Checkpoint — aggregation logic
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 5. Implement `validateExecutionInsert`
  - [ ] 5.1 Add `validateExecutionInsert(execution, parentQarAmount, currentFulfilledQar)` to `src/features/parent-order-fulfillment/validation.ts` following the formal specification in the design
    - Check `sold_qar_amount <= 0` → `invalid_amount`
    - Check `fx_rate_qar_to_egp <= 0` → `invalid_rate`
    - Check `sold_qar_amount > (parentQarAmount − currentFulfilledQar)` → `amount_exceeds_remaining`
    - Check `|egp_received_amount − (sold_qar_amount × fx_rate_qar_to_egp)| > 0.001` → `egp_mismatch`
    - Return `{ valid: true }` only when all checks pass
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 4.1, 4.2_

  - [ ]* 5.2 Write property test for `validateExecutionInsert`
    - **Property 4: Inserting an execution with `sold_qar_amount > remaining` always returns `{ valid: false, reason: 'amount_exceeds_remaining' }`**
    - **Validates: Requirements 2.3, 4.2**

  - [ ]* 5.3 Write unit tests for `validateExecutionInsert`
    - All rejection branches: `invalid_amount`, `invalid_rate`, `amount_exceeds_remaining`, `egp_mismatch`, `parent_not_found`
    - Happy path: all checks pass → `{ valid: true }`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.7_

- [ ] 6. Implement `validateCashAccountForAcceptance`
  - [ ] 6.1 Add `validateCashAccountForAcceptance(accountId, userId, expectedCurrency, accounts)` to `src/features/parent-order-fulfillment/validation.ts` following the formal specification in the design
    - Check `accountId` null/empty → `no_account_selected`
    - Check no matching account in `accounts` → `wrong_owner`
    - Check matched account `currency !== expectedCurrency` → `currency_mismatch`
    - Check matched account `status !== 'active'` → `account_disabled`
    - Return `{ valid: true }` only when all checks pass
    - _Requirements: 7.4, 7.5, 7.6, 7.7, 7.8, 7.9_

  - [ ]* 6.2 Write unit tests for `validateCashAccountForAcceptance`
    - All four rejection reasons + happy path
    - _Requirements: 7.5, 7.6, 7.7, 7.8, 7.9_

- [ ] 7. Implement `detectMobileInstallContext`
  - [ ] 7.1 Create `src/features/parent-order-fulfillment/mobileInstall.ts` and implement `detectMobileInstallContext()` following the formal specification in the design
    - Derive `isMobileBrowser`, `isInstalled`, `platform`, `nativePromptAvailable`, `promptState`
    - Use `window.innerWidth`, `navigator.userAgent`, `sessionStorage`, Capacitor native detection
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7_

  - [ ]* 7.2 Write unit tests for `detectMobileInstallContext`
    - Mock `window`, `navigator.userAgent`, `sessionStorage`, Capacitor APIs
    - Cover: mobile browser, desktop, installed PWA, native app, dismissed session, Android, iOS
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7_

- [ ] 8. Checkpoint — pure logic layer
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 9. Data hooks — `useParentOrderSummary` and `useOrderExecutions`
  - [ ] 9.1 Create `src/features/parent-order-fulfillment/hooks/useParentOrderSummary.ts`
    - Fetch all `order_executions` rows for a given `parent_order_id` from Supabase
    - Call `computeParentSummary` over the fetched rows
    - Subscribe to Supabase realtime `postgres_changes` on `order_executions` filtered by `parent_order_id`; recompute summary on each event without a full page reload
    - _Requirements: 3.1–3.14, 6.6, 6.7_

  - [ ] 9.2 Create `src/features/parent-order-fulfillment/hooks/useOrderExecutions.ts`
    - Fetch child `order_executions` rows for a given `parent_order_id`, ordered by `sequence_number` ascending
    - Expose loading and error states
    - _Requirements: 3.14, 6.4, 6.5_

- [ ] 10. Data hook — `useCashAccountsForUser`
  - [ ] 10.1 Create `src/features/parent-order-fulfillment/hooks/useCashAccountsForUser.ts`
    - Query cash accounts scoped to the authenticated customer's `user_id`
    - Filter out rows where `is_merchant_account = true` at the query layer
    - Never expose accounts belonging to a different user
    - _Requirements: 7.2, 8.1, 8.2, 8.3, 8.4_

- [ ] 11. UI — `ParentOrderCard` with collapsed/expanded execution table
  - [ ] 11.1 Create `src/features/parent-order-fulfillment/components/ParentOrderCard.tsx`
    - Render collapsed row showing `ParentOrderSummary`: fulfilled amount, remaining amount, weighted average FX, fulfillment status, progress
    - Toggle expanded state on user click
    - Render `ExpandedExecutionTable` lazily only when expanded
    - _Requirements: 6.1, 6.2, 6.3, 6.5_

  - [ ] 11.2 Create `src/features/parent-order-fulfillment/components/ExpandedExecutionTable.tsx`
    - Render each `OrderExecution` row with: sequence number, sold QAR amount, FX rate, EGP received, market type, status, executed-at timestamp
    - _Requirements: 6.2, 6.3, 6.4_

- [ ] 12. UI — `AcceptOrderModal` with `CashAccountSelector`
  - [ ] 12.1 Create `src/features/parent-order-fulfillment/components/CashAccountSelector.tsx`
    - List only cash accounts from `useCashAccountsForUser` (read-only, no create/edit/delete)
    - Disable Accept button and show inline hint while no account is selected
    - Grey out disabled accounts with tooltip; show inline warning chip on currency mismatch
    - _Requirements: 7.1, 7.2, 7.3, 7.14, 7.15, 8.5_

  - [ ] 12.2 Create `src/features/parent-order-fulfillment/components/AcceptOrderModal.tsx`
    - Show `CashAccountSelector` when customer clicks "Accept Order"
    - On confirm: call `validateCashAccountForAcceptance`; if valid, call `respondSharedOrder` RPC with `action: 'approve'` and `destination_cash_account_id`
    - On success: display success toast and update order card
    - On `wrong_owner` failure: display error toast and clear selection
    - _Requirements: 7.1, 7.4, 7.10, 7.12, 7.13, 8.6_

- [ ] 13. UI — `MobileInstallBanner`
  - [ ] 13.1 Create `src/features/parent-order-fulfillment/components/MobileInstallBanner.tsx` and `useMobileInstallPrompt.ts` hook
    - Use `detectMobileInstallContext()` to determine whether to show the banner
    - On Android with `nativePromptAvailable`: trigger `BeforeInstallPromptEvent`; otherwise show manual instructions
    - On iOS: show "Tap Share → Add to Home Screen" instructions
    - On dismiss: set `sessionStorage` key `install_prompt_dismissed = 'true'` and hide for the session
    - On defer (close without explicit dismiss): allow re-show on next navigation
    - Never show when already installed (PWA or native) or on desktop
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9, 10.1–10.7_

- [ ] 14. Wire everything into `CustomerOrdersPage`
  - [ ] 14.1 Import and render `ParentOrderCard` (with `useParentOrderSummary`) for each parent order in the existing `CustomerOrdersPage`
    - Ensure realtime subscription is active per card
    - _Requirements: 6.1, 6.6, 6.7_

  - [ ] 14.2 Mount `MobileInstallBanner` at the page level so it appears on mobile browser access
    - _Requirements: 9.1_

  - [ ]* 14.3 Write integration tests for the customer acceptance flow
    - Attempt approval without account → blocked (Accept button disabled)
    - Attempt approval with valid account → `respondSharedOrder` called with correct payload; `destination_cash_account_id` stored
    - Attempt approval with wrong-owner account → error toast, selection cleared
    - _Requirements: 7.1, 7.3, 7.10, 7.11, 7.12, 7.13, 8.6_

  - [ ]* 14.4 Write integration tests for client account isolation
    - Customer A cannot see or select accounts belonging to customer B or any merchant account
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

- [ ] 15. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- `fast-check` must be added as a dev dependency before running property tests
- All new code is additive — no existing pricing engine, settlement engine, merchant portal, ledger posting, or accounting rule is modified (Requirement 11)
- The DB trigger/RPC for overfill prevention (Task 1) is the authoritative guard; `validateExecutionInsert` (Task 5) is the application-layer guard — both are required
- Property tests (Tasks 3.2, 5.2) map directly to the "Correctness Properties" section of the design document
