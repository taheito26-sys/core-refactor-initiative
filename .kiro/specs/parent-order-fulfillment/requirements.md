# Requirements Document

## Introduction

The Parent Order Fulfillment feature enables a parent order (e.g. 50,000 QAR) to be fulfilled through one or more child sell executions, each potentially at a different FX rate. The system derives a weighted average FX rate from all completed child executions, tracks fulfillment progress, enforces overfill prevention, and surfaces a collapsed/expanded UI in the customer portal. Acceptance of an order requires the client to select a destination cash account. The client portal inherits merchant cash management logic in a read-only, scoped manner. The mobile app enforces installation prompts when running in a browser on a mobile device.

All new behavior is additive. No existing pricing engine, settlement engine, merchant portal, ledger posting, or accounting rule is modified.

---

## Glossary

- **Parent_Order**: A `customer_orders` row representing the full order amount (e.g. 50,000 QAR) that may be fulfilled through one or more executions.
- **Order_Execution**: A single child sell execution row in `order_executions`, linked to a Parent_Order via `parent_order_id`.
- **Aggregation_Layer**: The client-side or server-side logic (`computeParentSummary`) that derives fulfillment state from all completed Order_Executions for a given Parent_Order.
- **Parent_Order_Summary**: The computed aggregate object containing `fulfilled_qar`, `remaining_qar`, `weighted_avg_fx`, `fulfillment_status`, `progress_percent`, and the child execution list.
- **Weighted_Avg_FX**: The FX rate computed as `SUM(sold_qar_amount × fx_rate_qar_to_egp) / SUM(sold_qar_amount)` across all completed executions — never a simple average.
- **Fulfillment_Status**: One of `unfulfilled`, `partially_fulfilled`, or `fully_fulfilled`, derived from the ratio of `fulfilled_qar` to `parent_qar_amount`.
- **Execution_Validator**: The function `validateExecutionInsert` that checks an incoming Order_Execution for validity before it is persisted.
- **Cash_Account_Validator**: The function `validateCashAccountForAcceptance` that checks a selected cash account before order acceptance is committed.
- **Cash_Account_Selector**: The UI component shown to the client when accepting an order, allowing selection of a destination cash account.
- **Customer_Portal**: The web application used by clients (customers) to view and accept orders.
- **Mobile_Install_Banner**: The UI component that detects a mobile browser context and prompts the user to install the native or PWA app.
- **Install_Prompt_State**: One of `not_applicable`, `pending`, or `dismissed`, representing the current state of the mobile install prompt.
- **Execution_Table**: The expanded UI component that renders child Order_Execution rows for a given Parent_Order.
- **Sequence_Number**: An auto-incrementing integer per Parent_Order that orders child executions chronologically.

---

## Requirements

### Requirement 1: Child Execution Data Model

**User Story:** As a merchant, I want to record individual sell executions against a parent order, so that each partial fill is tracked with its own FX rate, amount, and market type.

#### Acceptance Criteria

1. THE System SHALL store each Order_Execution in an `order_executions` table with columns: `id`, `parent_order_id`, `sequence_number`, `sold_qar_amount`, `fx_rate_qar_to_egp`, `egp_received_amount`, `market_type`, `cash_account_id`, `status`, `executed_at`, `created_by`, `created_at`, `updated_at`.
2. THE System SHALL enforce a CHECK constraint that `sold_qar_amount > 0` on the `order_executions` table.
3. THE System SHALL enforce a CHECK constraint that `fx_rate_qar_to_egp > 0` on the `order_executions` table.
4. THE System SHALL store `egp_received_amount` as a generated column equal to `sold_qar_amount × fx_rate_qar_to_egp`.
5. THE System SHALL enforce a foreign key from `order_executions.parent_order_id` to `customer_orders.id`.
6. THE System SHALL assign `sequence_number` as an auto-incrementing integer scoped per `parent_order_id`.
7. THE System SHALL accept `market_type` values of `instapay_v1`, `p2p`, `bank`, or `manual` only.
8. THE System SHALL accept `status` values of `completed`, `pending`, `cancelled`, or `failed` only.
9. THE System SHALL allow `cash_account_id` to be null on an Order_Execution row.
10. THE System SHALL store `executed_at` as a timezone-aware timestamp.

---

### Requirement 2: Execution Insert Validation

**User Story:** As a merchant, I want the system to reject invalid execution inserts, so that data integrity is maintained and overfill is impossible.

#### Acceptance Criteria

1. WHEN an Order_Execution insert is attempted with `sold_qar_amount <= 0`, THEN THE Execution_Validator SHALL reject it with reason `invalid_amount`.
2. WHEN an Order_Execution insert is attempted with `fx_rate_qar_to_egp <= 0`, THEN THE Execution_Validator SHALL reject it with reason `invalid_rate`.
3. WHEN an Order_Execution insert is attempted where `sold_qar_amount > (parent_qar_amount − current_fulfilled_qar)`, THEN THE Execution_Validator SHALL reject it with reason `amount_exceeds_remaining`.
4. WHEN an Order_Execution insert is attempted where `|egp_received_amount − (sold_qar_amount × fx_rate_qar_to_egp)| > 0.001`, THEN THE Execution_Validator SHALL reject it with reason `egp_mismatch`.
5. WHEN all validation checks pass, THEN THE Execution_Validator SHALL return `{ valid: true }`.
6. THE System SHALL hold a row-level lock on the Parent_Order during the remaining-amount check to prevent race conditions from concurrent execution inserts.
7. IF `parent_order_id` does not reference an existing `customer_orders` row, THEN THE System SHALL reject the insert with reason `parent_not_found`.

---

### Requirement 3: Parent Order Aggregation

**User Story:** As a merchant or customer, I want to see the aggregated fulfillment state of a parent order, so that I can understand how much has been filled, at what weighted average rate, and what remains.

#### Acceptance Criteria

1. WHEN `computeParentSummary` is called, THE Aggregation_Layer SHALL compute `fulfilled_qar` as the sum of `sold_qar_amount` for all Order_Executions with `status = 'completed'`.
2. WHEN `computeParentSummary` is called, THE Aggregation_Layer SHALL compute `remaining_qar` as `parent_qar_amount − fulfilled_qar`.
3. WHEN `computeParentSummary` is called, THE Aggregation_Layer SHALL compute `total_egp_received` as the sum of `egp_received_amount` for all Order_Executions with `status = 'completed'`.
4. WHEN `computeParentSummary` is called, THE Aggregation_Layer SHALL compute `fill_count` as the count of Order_Executions with `status = 'completed'`.
5. WHEN `computeParentSummary` is called, THE Aggregation_Layer SHALL compute `progress_percent` as `(fulfilled_qar / parent_qar_amount) × 100`.
6. WHEN `fill_count > 0`, THE Aggregation_Layer SHALL compute `weighted_avg_fx` as `total_egp_received / fulfilled_qar`.
7. WHEN `fill_count = 0`, THE Aggregation_Layer SHALL set `weighted_avg_fx` to `null`.
8. THE Aggregation_Layer SHALL never compute `weighted_avg_fx` as a simple average of individual FX rates.
9. THE Aggregation_Layer SHALL set `fulfillment_status` to `unfulfilled` when `fulfilled_qar = 0`.
10. THE Aggregation_Layer SHALL set `fulfillment_status` to `partially_fulfilled` when `0 < fulfilled_qar < parent_qar_amount`.
11. THE Aggregation_Layer SHALL set `fulfillment_status` to `fully_fulfilled` when `fulfilled_qar = parent_qar_amount`.
12. THE Aggregation_Layer SHALL return `remaining_qar >= 0` for all valid inputs.
13. THE Aggregation_Layer SHALL return `progress_percent` in the range `[0, 100]` for all valid inputs.
14. THE Aggregation_Layer SHALL include all child Order_Executions in the `executions` array, ordered by `sequence_number` ascending.

---

### Requirement 4: Overfill Prevention

**User Story:** As a system operator, I want overfill to be impossible, so that the sum of completed execution amounts never exceeds the parent order amount.

#### Acceptance Criteria

1. THE System SHALL ensure that `SUM(sold_qar_amount for completed executions) <= parent_qar_amount` at all times.
2. WHEN an execution insert would cause the total fulfilled amount to exceed `parent_qar_amount`, THEN THE Execution_Validator SHALL reject it with reason `amount_exceeds_remaining`.
3. THE System SHALL enforce overfill prevention at the database layer (via trigger or RPC), not only at the application layer.
4. WHILE a concurrent execution insert is in progress, THE System SHALL hold a row-level lock on the Parent_Order to prevent race conditions.

---

### Requirement 5: System Integrity — Weighted Average Scenario

**User Story:** As a system operator, I want the weighted average FX calculation to produce the correct result for the canonical 50,000 QAR / 3-execution scenario, so that I can verify the formula is implemented correctly.

#### Acceptance Criteria

1. WHEN three Order_Executions are inserted against a 50,000 QAR Parent_Order with amounts and rates that yield a weighted average of 13.385, THEN THE Aggregation_Layer SHALL compute `weighted_avg_fx = 13.385`.
2. WHEN the three executions collectively cover the full 50,000 QAR, THEN THE Aggregation_Layer SHALL set `fulfillment_status = 'fully_fulfilled'`.
3. WHEN the three executions collectively cover the full 50,000 QAR, THEN THE Aggregation_Layer SHALL set `remaining_qar = 0`.
4. WHEN the three executions collectively cover the full 50,000 QAR, THEN THE Aggregation_Layer SHALL set `progress_percent = 100`.

---

### Requirement 6: Expand/Collapse UI for Parent Orders

**User Story:** As a customer, I want to expand a parent order row to see its individual child executions, so that I can review the details of each partial fill.

#### Acceptance Criteria

1. THE Customer_Portal SHALL render each Parent_Order as a collapsed row showing the Parent_Order_Summary (fulfilled amount, remaining amount, weighted average FX, fulfillment status, progress).
2. WHEN a user expands a Parent_Order row, THE Customer_Portal SHALL render the Execution_Table showing all child Order_Executions for that parent.
3. WHEN a user collapses a Parent_Order row, THE Customer_Portal SHALL hide the Execution_Table.
4. THE Execution_Table SHALL render each Order_Execution row with: sequence number, sold QAR amount, FX rate, EGP received, market type, status, and executed-at timestamp.
5. THE Customer_Portal SHALL render the Execution_Table lazily — only when the user expands the row.
6. THE Customer_Portal SHALL subscribe to Supabase realtime events on `order_executions` filtered by `parent_order_id` and update the displayed summary when new executions are inserted.
7. WHEN the Aggregation_Layer recomputes after a new execution, THE Customer_Portal SHALL reflect the updated Parent_Order_Summary without a full page reload.

---

### Requirement 7: Client Order Acceptance with Cash Account Selection

**User Story:** As a customer, I want to select a destination cash account when accepting an order, so that the system knows where to credit the received funds.

#### Acceptance Criteria

1. WHEN a customer clicks "Accept Order", THE Customer_Portal SHALL display the Cash_Account_Selector modal before submitting the acceptance.
2. THE Cash_Account_Selector SHALL list only cash accounts owned by the authenticated customer.
3. WHILE no cash account is selected, THE Customer_Portal SHALL disable the Accept button and display an inline hint.
4. WHEN a customer selects a cash account and confirms, THE Cash_Account_Validator SHALL validate the selected account before the acceptance RPC is called.
5. IF the selected `destination_cash_account_id` is null or empty, THEN THE Cash_Account_Validator SHALL return `{ valid: false, reason: 'no_account_selected' }`.
6. IF the selected account does not belong to the authenticated customer, THEN THE Cash_Account_Validator SHALL return `{ valid: false, reason: 'wrong_owner' }`.
7. IF the selected account's currency does not match the order's receive currency, THEN THE Cash_Account_Validator SHALL return `{ valid: false, reason: 'currency_mismatch' }`.
8. IF the selected account's status is not `active`, THEN THE Cash_Account_Validator SHALL return `{ valid: false, reason: 'account_disabled' }`.
9. WHEN all validation checks pass, THE Cash_Account_Validator SHALL return `{ valid: true }`.
10. WHEN validation passes, THE Customer_Portal SHALL call `respondSharedOrder` with `action: 'approve'` and `destination_cash_account_id` set to the selected account.
11. WHEN the acceptance RPC succeeds, THE System SHALL store `destination_cash_account_id` on the `customer_orders` row.
12. WHEN the acceptance RPC succeeds, THE Customer_Portal SHALL display a success toast and update the order card.
13. IF validation fails with `wrong_owner`, THE Customer_Portal SHALL display an error toast and clear the selection.
14. IF validation fails with `currency_mismatch`, THE Customer_Portal SHALL display an inline warning on the account chip.
15. IF validation fails with `account_disabled`, THE Customer_Portal SHALL grey out the account in the selector and display a tooltip.

---

### Requirement 8: Client Cash Management — Scoped and Read-Only

**User Story:** As a customer, I want to view my own cash accounts in the portal, so that I can select a destination account when accepting an order, without seeing merchant accounts or other customers' accounts.

#### Acceptance Criteria

1. THE Customer_Portal SHALL fetch cash accounts using a query scoped to the authenticated customer's `user_id`.
2. THE Customer_Portal SHALL never display cash accounts where `is_merchant_account = true`.
3. THE Customer_Portal SHALL never display cash accounts belonging to a different customer's `user_id`.
4. THE System SHALL enforce client account isolation at the query layer, not only at the UI layer.
5. THE Customer_Portal SHALL display cash accounts in a read-only manner — customers cannot create, edit, or delete accounts from this view.
6. THE System SHALL validate at the RPC layer that `destination_cash_account_id` belongs to the calling user before storing it.

---

### Requirement 9: Mobile App Install Enforcement

**User Story:** As a product owner, I want mobile browser users to be prompted to install the native or PWA app, so that they use the optimized mobile experience.

#### Acceptance Criteria

1. WHEN a user accesses the Customer_Portal on a mobile browser (`window.innerWidth < 768` and not a native app), THE Mobile_Install_Banner SHALL display an install prompt.
2. WHEN the platform is `android` and a `BeforeInstallPromptEvent` has been captured, THE Mobile_Install_Banner SHALL trigger the native Android install prompt.
3. WHEN the platform is `ios`, THE Mobile_Install_Banner SHALL display manual iOS installation instructions ("Tap Share → Add to Home Screen").
4. WHEN a user dismisses the Mobile_Install_Banner, THE System SHALL set `sessionStorage` key `install_prompt_dismissed` to `'true'` and suppress the prompt for the remainder of the session.
5. WHEN `install_prompt_dismissed` is `'true'` in `sessionStorage`, THE Mobile_Install_Banner SHALL not display the prompt.
6. WHEN the app is already installed (PWA or native), THE Mobile_Install_Banner SHALL not display the prompt.
7. WHEN the user is not on a mobile browser, THE Mobile_Install_Banner SHALL not display the prompt.
8. WHEN a `BeforeInstallPromptEvent` has not been captured on Android, THE Mobile_Install_Banner SHALL fall back to displaying manual installation instructions.
9. WHEN a user defers the prompt (closes without explicit dismiss), THE System SHALL allow the prompt to re-appear on the next navigation.

---

### Requirement 10: Mobile Install Context Detection

**User Story:** As a developer, I want the system to accurately detect the mobile install context, so that the correct prompt type is shown for each platform.

#### Acceptance Criteria

1. THE System SHALL set `isMobileBrowser = true` if and only if `window.innerWidth < 768` AND the app is not running as a native app.
2. THE System SHALL set `isInstalled = true` if the app is running as an installed PWA or as a native Capacitor app.
3. THE System SHALL derive `platform` from `navigator.userAgent`: `'android'` if the user agent matches `/android/i`, `'ios'` if it matches `/iphone|ipad|ipod/i`, otherwise `'other'`.
4. THE System SHALL set `nativePromptAvailable = true` if and only if a `BeforeInstallPromptEvent` has been captured and not yet consumed.
5. THE System SHALL set `promptState = 'not_applicable'` when `isInstalled = true` or `isMobileBrowser = false`.
6. THE System SHALL set `promptState = 'dismissed'` when `sessionStorage.getItem('install_prompt_dismissed') === 'true'`.
7. THE System SHALL set `promptState = 'pending'` when neither of the above conditions applies.

---

### Requirement 11: Non-Regression — Additive Changes Only

**User Story:** As a system operator, I want all new behavior to be additive, so that no existing pricing engine, settlement engine, merchant portal, ledger posting, or accounting rule is modified.

#### Acceptance Criteria

1. THE System SHALL NOT modify the pricing engine when inserting or processing Order_Executions.
2. THE System SHALL NOT modify the settlement engine when inserting or processing Order_Executions.
3. THE System SHALL NOT modify any merchant portal behavior as part of this feature.
4. THE System SHALL NOT modify any ledger posting logic as part of this feature.
5. THE System SHALL NOT modify any accounting rules as part of this feature.
6. THE `order_executions` table SHALL store the FX rate as a merchant-supplied value and SHALL NOT read from or write to the pricing engine.
7. THE System SHALL add `destination_cash_account_id` to `customer_orders` as a new nullable column without altering existing columns or constraints.
