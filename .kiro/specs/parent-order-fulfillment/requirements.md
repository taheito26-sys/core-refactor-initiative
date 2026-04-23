# Requirements Document

## Introduction

The Parent Order Fulfillment feature enables a parent order (e.g. 20,000 QAR) to be fulfilled through one or more child sell executions (phases), each potentially at a different EGP/USDT rate. The system uses USDT as the intermediary currency: the parent order's QAR amount is converted to a `required_usdt` target at order creation time, and each phase records EGP executed and the EGP/USDT rate to compute how much USDT was fulfilled. Progress is tracked as `fulfilled_usdt / required_usdt`, NOT as QAR-based progress.

Each phase stores snapshot values at the time of entry: `executed_egp`, `egp_per_usdt`, `phase_usdt`, `phase_consumed_qar`, and `phase_qar_egp_fx`. These snapshots are immutable after save — the system never depends on live merchant rates after a phase is persisted.

The system derives a weighted average QAR→EGP FX rate from all completed child phases, tracks USDT-based fulfillment progress, enforces overfill prevention (in USDT space), and surfaces a collapsed/expanded UI in the customer portal. Acceptance of an order requires the client to select a destination cash account. The client portal inherits merchant cash management logic in a read-only, scoped manner. The mobile app enforces installation prompts when running in a browser on a mobile device.

**Critical invariant:** Once phases exist for a parent order, all parent-level totals (total EGP, total consumed QAR, total fulfilled USDT, weighted average FX, progress) are derived exclusively from persisted phase snapshot rows. Manually entered totals are never trusted. The system must never display a parent total that differs from the sum of its child phase snapshots.

**Example:** Parent: 20,000 QAR at rate 3.8 → required_usdt = 5,263.157895. Phase 1: 120,000 EGP at 53 EGP/USDT → phase_usdt = 2,264.150943, consumed_qar = 8,603.773585, fx = 13.948.

All new behavior is additive. No existing pricing engine, settlement engine, merchant portal, ledger posting, or accounting rule is modified.

---

## Glossary

- **Parent_Order**: A `customer_orders` row representing the full order amount (e.g. 20,000 QAR) that may be fulfilled through one or more executions. Stores `usdt_qar_rate` and `required_usdt` at creation time.
- **Order_Execution**: A single child phase row in `order_executions`, linked to a Parent_Order via `parent_order_id`. Stores snapshot values: `executed_egp`, `egp_per_usdt`, `phase_usdt`, `phase_consumed_qar`, `phase_qar_egp_fx`.
- **Aggregation_Layer**: The client-side or server-side logic (`computeParentSummary`) that derives fulfillment state from all completed Order_Executions for a given Parent_Order.
- **Parent_Order_Summary**: The computed aggregate object containing `total_fulfilled_usdt`, `required_usdt`, `total_consumed_qar`, `total_egp`, `weighted_avg_fx`, `fulfillment_status`, `progress_percent`, and the child execution list.
- **Weighted_Avg_FX**: The QAR→EGP FX rate computed as `total_egp / total_consumed_qar` across all completed phases — never a simple average of individual phase rates.
- **Fulfillment_Status**: One of `unfulfilled`, `partially_fulfilled`, or `fully_fulfilled`, derived from the ratio of `total_fulfilled_usdt` to `required_usdt`.
- **Execution_Validator**: The function `validateExecutionInsert` that checks an incoming Order_Execution for validity before it is persisted.
- **Cash_Account_Validator**: The function `validateCashAccountForAcceptance` that checks a selected cash account before order acceptance is committed.
- **Cash_Account_Selector**: The UI component shown to the client when accepting an order, allowing selection of a destination cash account.
- **Customer_Portal**: The web application used by clients (customers) to view and accept orders.
- **Mobile_Install_Banner**: The UI component that detects a mobile browser context and prompts the user to install the native or PWA app.
- **Install_Prompt_State**: One of `not_applicable`, `pending`, or `dismissed`, representing the current state of the mobile install prompt.
- **Execution_Table**: The expanded UI component that renders child Order_Execution rows for a given Parent_Order.
- **Sequence_Number**: An auto-incrementing integer per Parent_Order that orders child executions chronologically.
- **Phase**: Synonym for Order_Execution in the context of phased fulfillment. Each phase represents one partial execution of the parent order.
- **USDT**: The intermediary currency used for fulfillment tracking. Parent orders define a `required_usdt` target; phases contribute `phase_usdt` toward that target.
- **required_usdt**: The USDT fulfillment target for a parent order, calculated as `received_qar / usdt_qar_rate` at order creation time. This value is immutable after creation.
- **phase_usdt**: The USDT equivalent fulfilled by a single phase, calculated as `executed_egp / egp_per_usdt` at phase entry time. This is a snapshot value.
- **phase_consumed_qar**: The QAR consumed by a single phase, calculated as `phase_usdt * parent_usdt_qar_rate` at phase entry time. This is a snapshot value.
- **phase_qar_egp_fx**: The effective QAR→EGP FX rate for a single phase, calculated as `executed_egp / phase_consumed_qar` at phase entry time. This is a snapshot value.
- **Derived_Aggregate**: A parent-level value (total_egp, total_consumed_qar, total_fulfilled_usdt, weighted_avg_fx, progress) that is computed exclusively from persisted child phase snapshot rows — never from manually entered or cached values.
- **Client_Card**: A single compact UI card in the Customer_Portal that represents one Parent_Order, grouping all its child phases into one visual unit.
- **Realtime_Subscription**: A Supabase `postgres_changes` subscription that pushes database events to the client without requiring a page refresh.
- **Notification**: A toast or in-app message sent to the client when a phase is added or order state changes.

---

## Requirements

### Requirement 1: Parent Order and Phase Data Model

**User Story:** As a merchant, I want to record a parent order with its USDT target and individual phase executions against it, so that each partial fill is tracked with its own EGP amount, EGP/USDT rate, and derived snapshot values.

#### Acceptance Criteria

1. THE System SHALL store `usdt_qar_rate` (numeric, > 0) on the `customer_orders` table for parent orders that use phased fulfillment.
2. THE System SHALL store `required_usdt` as a generated or computed column on `customer_orders`, equal to `received_qar / usdt_qar_rate`.
3. THE System SHALL store each Order_Execution in an `order_executions` table with columns: `id`, `parent_order_id`, `sequence_number`, `executed_egp`, `egp_per_usdt`, `phase_usdt`, `phase_consumed_qar`, `phase_qar_egp_fx`, `market_type`, `cash_account_id`, `status`, `executed_at`, `created_by`, `created_at`, `updated_at`.
4. THE System SHALL enforce a CHECK constraint that `executed_egp > 0` on the `order_executions` table.
5. THE System SHALL enforce a CHECK constraint that `egp_per_usdt > 0` on the `order_executions` table.
6. THE System SHALL store `phase_usdt` as a generated column equal to `executed_egp / egp_per_usdt`.
7. THE System SHALL store `phase_consumed_qar` as a generated column equal to `phase_usdt * parent_usdt_qar_rate` (looked up from the parent order's `usdt_qar_rate`).
8. THE System SHALL store `phase_qar_egp_fx` as a generated column equal to `executed_egp / phase_consumed_qar`.
9. THE System SHALL enforce a foreign key from `order_executions.parent_order_id` to `customer_orders.id`.
10. THE System SHALL assign `sequence_number` as an auto-incrementing integer scoped per `parent_order_id`.
11. THE System SHALL accept `market_type` values of `instapay_v1`, `p2p`, `bank`, or `manual` only.
12. THE System SHALL accept `status` values of `completed`, `pending`, `cancelled`, or `failed` only.
13. THE System SHALL allow `cash_account_id` to be null on an Order_Execution row.
14. THE System SHALL store `executed_at` as a timezone-aware timestamp.
15. ALL phase snapshot values (`phase_usdt`, `phase_consumed_qar`, `phase_qar_egp_fx`) SHALL be immutable after the phase is saved — the system SHALL NOT recalculate them based on live rates.

---

### Requirement 2: Phase Entry Validation

**User Story:** As a merchant, I want the system to reject invalid phase entries, so that data integrity is maintained, overfill is impossible (in USDT space), and no phase can be saved with missing or invalid inputs.

#### Acceptance Criteria

1. WHEN a phase insert is attempted with `executed_egp <= 0`, THEN THE Execution_Validator SHALL reject it with reason `invalid_amount`.
2. WHEN a phase insert is attempted with `egp_per_usdt <= 0`, THEN THE Execution_Validator SHALL reject it with reason `invalid_rate`.
3. WHEN a phase insert would cause `total_fulfilled_usdt + phase_usdt > required_usdt`, THEN THE Execution_Validator SHALL reject it with reason `amount_exceeds_remaining`.
4. WHEN all validation checks pass, THEN THE Execution_Validator SHALL return `{ valid: true }`.
5. THE System SHALL hold a row-level lock on the Parent_Order during the remaining-USDT check to prevent race conditions from concurrent phase inserts.
6. IF `parent_order_id` does not reference an existing `customer_orders` row, THEN THE System SHALL reject the insert with reason `parent_not_found`.
7. THE Execution_Validator SHALL treat `egp_per_usdt` as a mandatory field — WHEN the rate is empty, null, or undefined, THEN THE Execution_Validator SHALL reject the insert with reason `invalid_rate` and SHALL NOT persist the record.
8. THE Execution_Validator SHALL treat `executed_egp` as a mandatory field — WHEN the amount is empty, null, or undefined, THEN THE Execution_Validator SHALL reject the insert with reason `invalid_amount` and SHALL NOT persist the record.
9. THE System SHALL block save of any phase row where `executed_egp` is empty or `<= 0`, or `egp_per_usdt` is empty or `<= 0`.
10. THE System SHALL NOT allow partial phase rows with a missing rate — every persisted Order_Execution row SHALL have a valid `egp_per_usdt > 0`.
11. IF validation fails for any reason, THEN THE System SHALL display a validation error message to the user and SHALL NOT persist the Order_Execution record.

---

### Requirement 3: Parent Order Aggregation (USDT-Based Progress)

**User Story:** As a merchant or customer, I want to see the aggregated fulfillment state of a parent order with USDT-based progress tracking, derived exclusively from persisted child phase snapshot rows, so that parent totals always match the sum of child phases and no manually entered total is ever trusted.

#### Acceptance Criteria

1. WHEN `computeParentSummary` is called, THE Aggregation_Layer SHALL compute `total_fulfilled_usdt` as the sum of `phase_usdt` for all Order_Executions with `status = 'completed'`.
2. WHEN `computeParentSummary` is called, THE Aggregation_Layer SHALL compute `remaining_usdt` as `required_usdt − total_fulfilled_usdt`.
3. WHEN `computeParentSummary` is called, THE Aggregation_Layer SHALL compute `total_egp` as the sum of `executed_egp` for all Order_Executions with `status = 'completed'`.
4. WHEN `computeParentSummary` is called, THE Aggregation_Layer SHALL compute `total_consumed_qar` as the sum of `phase_consumed_qar` for all Order_Executions with `status = 'completed'`.
5. WHEN `computeParentSummary` is called, THE Aggregation_Layer SHALL compute `fill_count` as the count of Order_Executions with `status = 'completed'`.
6. WHEN `computeParentSummary` is called, THE Aggregation_Layer SHALL compute `progress_percent` as `(total_fulfilled_usdt / required_usdt) × 100`.
7. WHEN `fill_count > 0`, THE Aggregation_Layer SHALL compute `weighted_avg_fx` as `total_egp / total_consumed_qar` — never a simple average of individual `phase_qar_egp_fx` rates.
8. WHEN `fill_count = 0`, THE Aggregation_Layer SHALL set `weighted_avg_fx` to `null`.
9. THE Aggregation_Layer SHALL set `fulfillment_status` to `unfulfilled` when `total_fulfilled_usdt = 0`.
10. THE Aggregation_Layer SHALL set `fulfillment_status` to `partially_fulfilled` when `0 < total_fulfilled_usdt < required_usdt`.
11. THE Aggregation_Layer SHALL set `fulfillment_status` to `fully_fulfilled` when `total_fulfilled_usdt >= required_usdt`.
12. THE Aggregation_Layer SHALL return `remaining_usdt >= 0` for all valid inputs.
13. THE Aggregation_Layer SHALL return `progress_percent` in the range `[0, 100]` for all valid inputs.
14. THE Aggregation_Layer SHALL include all child Order_Executions in the `executions` array, ordered by `sequence_number` ascending.
15. WHILE one or more child phases exist for a Parent_Order, THE System SHALL derive all parent-level totals exclusively from persisted child phase snapshot rows — THE System SHALL never trust or display a manually entered parent total.
16. THE Aggregation_Layer SHALL compute progress using USDT, NOT QAR: `progress = total_fulfilled_usdt / required_usdt`.
17. THE Aggregation_Layer SHALL compute weighted average FX as `total_egp / total_consumed_qar` — never a snapshot rate, never a manually entered value, never a simple average of phase rates.

---

### Requirement 4: Overfill Prevention (USDT Space)

**User Story:** As a system operator, I want overfill to be impossible in USDT space, so that the sum of completed phase USDT amounts never exceeds the parent order's required USDT target.

#### Acceptance Criteria

1. THE System SHALL ensure that `SUM(phase_usdt for completed phases) <= required_usdt` at all times.
2. WHEN a phase insert would cause the total fulfilled USDT to exceed `required_usdt`, THEN THE Execution_Validator SHALL reject it with reason `amount_exceeds_remaining`.
3. THE System SHALL enforce overfill prevention at the database layer (via trigger or RPC), not only at the application layer.
4. WHILE a concurrent phase insert is in progress, THE System SHALL hold a row-level lock on the Parent_Order to prevent race conditions.

---

### Requirement 5: System Integrity — USDT-Based Fulfillment Scenario

**User Story:** As a system operator, I want the USDT-based fulfillment calculation to produce the correct result for the canonical scenario, so that I can verify the formulas are implemented correctly.

#### Acceptance Criteria

1. WHEN a Parent_Order is created with `received_qar = 20,000` and `usdt_qar_rate = 3.8`, THEN THE System SHALL compute `required_usdt = 5,263.157895` (20,000 / 3.8).
2. WHEN a phase is entered with `executed_egp = 120,000` and `egp_per_usdt = 53`, THEN THE System SHALL compute `phase_usdt = 2,264.150943` (120,000 / 53).
3. WHEN a phase is entered with `executed_egp = 120,000` and `egp_per_usdt = 53` against a parent with `usdt_qar_rate = 3.8`, THEN THE System SHALL compute `phase_consumed_qar = 8,603.773585` (2,264.150943 × 3.8).
4. WHEN a phase is entered with `executed_egp = 120,000` and `phase_consumed_qar = 8,603.773585`, THEN THE System SHALL compute `phase_qar_egp_fx = 13.948` (120,000 / 8,603.773585).
5. WHEN the single phase above is the only completed phase, THEN THE Aggregation_Layer SHALL compute `progress_percent = 43.02` (2,264.150943 / 5,263.157895 × 100).
6. WHEN the single phase above is the only completed phase, THEN THE Aggregation_Layer SHALL set `fulfillment_status = 'partially_fulfilled'`.

---

### Requirement 6: Single Client Card per Order with Expand/Collapse and Realtime Updates

**User Story:** As a customer, I want to see exactly one compact card per parent order that groups all partial executions, with an expandable section for phase details showing the new USDT-based fields, and I want the card to update in realtime when new phases are added — without page refresh and without duplicate notifications.

#### Acceptance Criteria

1. THE Customer_Portal SHALL render each Parent_Order as a single compact Client_Card showing the Parent_Order_Summary: total received QAR, total received EGP, total fulfilled USDT, required USDT, progress %, weighted average QAR→EGP FX, and order status.
2. WHEN a user expands a Client_Card, THE Customer_Portal SHALL render the Execution_Table showing all child phases for that parent inside the same card as an expandable section.
3. WHEN a user collapses a Client_Card, THE Customer_Portal SHALL hide the Execution_Table.
4. THE Execution_Table SHALL render each phase row with: phase number (sequence_number), consumed QAR (`phase_consumed_qar`), received EGP (`executed_egp`), QAR→EGP FX rate (`phase_qar_egp_fx`), and completion status.
5. THE Customer_Portal SHALL render the Execution_Table lazily — only when the user expands the card.
6. THE Customer_Portal SHALL subscribe to Supabase Realtime_Subscription events on `order_executions` filtered by `parent_order_id` and update the displayed summary when new phases are inserted.
7. WHEN the Aggregation_Layer recomputes after a new phase, THE Customer_Portal SHALL reflect the updated Parent_Order_Summary without a full page reload.
8. THE Customer_Portal SHALL NOT render multiple Client_Cards for the same Parent_Order — all phases for a given `parent_order_id` SHALL be grouped into exactly one Client_Card.
9. THE Customer_Portal SHALL group orders by `parent_order_id` before rendering, ensuring deduplication at the data layer.
10. THE Client_Card summary SHALL display all values as Derived_Aggregates computed from persisted child phase snapshot rows — never from manually entered or cached parent-level values.
11. WHEN a new phase is added to a Parent_Order, THE System SHALL execute the following sequence without page refresh: (a) save the phase to the database, (b) recalculate all parent aggregates from persisted phase snapshots, (c) update the Parent_Order record with new aggregates, (d) push the update to the client view via Realtime_Subscription, (e) send a Notification to the client.
12. THE System SHALL prevent duplicate Notifications — WHEN multiple realtime events arrive for the same phase insert, THE System SHALL deliver exactly one Notification to the client.
13. WHEN a Notification is sent for a new phase, THE Customer_Portal SHALL display a toast message indicating the order has been updated.
14. THE Customer_Portal SHALL use the existing Supabase realtime subscription system for all push updates — no new transport mechanism shall be introduced.
15. THE Client_Card SHALL display the phase count (number of completed phases) alongside the summary values.

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
6. THE `order_executions` table SHALL store the EGP/USDT rate as a merchant-supplied value and SHALL NOT read from or write to the pricing engine.
7. THE System SHALL add `usdt_qar_rate`, `required_usdt`, and `destination_cash_account_id` to `customer_orders` as new nullable columns without altering existing columns or constraints.

---

### Requirement 12: Data Consistency Guarantees

**User Story:** As a system operator, I want the system to guarantee that parent order values always equal the sum of child phase snapshots, so that no hidden totals, cached mismatched values, or stale aggregates are ever displayed to the client.

#### Acceptance Criteria

1. THE System SHALL enforce the invariant: parent order `total_egp` SHALL always equal `SUM(all child phase executed_egp)` for phases with `status = 'completed'`.
2. THE System SHALL enforce the invariant: parent order `total_consumed_qar` SHALL always equal `SUM(all child phase phase_consumed_qar)` for phases with `status = 'completed'`.
3. THE System SHALL enforce the invariant: parent order `weighted_avg_fx` SHALL always equal `total_egp / total_consumed_qar` when at least one completed phase exists.
4. THE System SHALL enforce the invariant: parent order `progress` SHALL always equal `total_fulfilled_usdt / required_usdt`.
5. THE System SHALL never display a state where `submitted_total ≠ SUM(phase snapshots)` — if a manually entered parent total exists and differs from the sum of child phase snapshots, THE System SHALL display the derived sum, not the manually entered value.
6. THE System SHALL NOT cache parent-level aggregate values independently of child phase data — all displayed aggregates SHALL be recomputed from persisted phase snapshot rows on every read or realtime event.
7. THE System SHALL NOT store hidden totals that could diverge from child phase sums — any stored parent-level aggregate SHALL be treated as a derived cache that is overwritten on every phase insert, update, or delete.
8. WHEN a phase is inserted, updated, or deleted, THE System SHALL immediately recompute all parent-level aggregates from the current set of persisted child phase snapshots.
9. THE System SHALL ensure that all values displayed in the Client_Card (total received QAR, total received EGP, total fulfilled USDT, required USDT, weighted average FX, progress %, fulfillment status) come from persisted child phase snapshot data — never from a separate manually entered field on the parent order.
10. IF a discrepancy is detected between a stored parent total and the computed sum of child phase snapshots, THEN THE System SHALL use the computed sum and log the discrepancy for investigation.
