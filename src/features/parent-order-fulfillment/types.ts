/**
 * Types and interfaces for the Parent Order Fulfillment feature.
 *
 * All types are additive — no existing types are modified.
 */

// Re-export CashAccount from the shared cash management module so consumers
// of this feature only need to import from one place.
export type { CashAccount } from '@/lib/tracker-helpers';

// ── Phase 1: Child Execution ──────────────────────────────────────────

/** Lifecycle status of a single order execution. */
export type ExecutionStatus = 'completed' | 'pending' | 'cancelled' | 'failed';

/** The market channel through which an execution was settled. */
export type MarketType = 'instapay_v1' | 'p2p' | 'bank' | 'manual';

/**
 * A single child sell execution linked to a parent order.
 * Maps 1-to-1 with a row in the `order_executions` table.
 */
export interface OrderExecution {
  /** UUID primary key. */
  id: string;
  /** FK → customer_orders.id */
  parent_order_id: string;
  /** Auto-incrementing integer scoped per parent_order_id. */
  sequence_number: number;
  /** Amount sold in QAR. Must be > 0. */
  sold_qar_amount: number;
  /** FX rate used for this execution (QAR → EGP). Must be > 0. */
  fx_rate_qar_to_egp: number;
  /** Generated column: sold_qar_amount × fx_rate_qar_to_egp. */
  egp_received_amount: number;
  /** Market channel for this execution. */
  market_type: MarketType;
  /** FK → cash_accounts.id (nullable — not all executions are linked to an account). */
  cash_account_id: string | null;
  /** Current lifecycle status. */
  status: ExecutionStatus;
  /** ISO 8601 timestamp of when the execution occurred. */
  executed_at: string;
  /** FK → auth.users.id — the user who created this execution. */
  created_by: string;
  /** ISO 8601 creation timestamp. */
  created_at: string;
  /** ISO 8601 last-updated timestamp. */
  updated_at: string;
}

// ── Phase 2: Parent Order Aggregation ────────────────────────────────

/**
 * Derived fulfillment state of a parent order based on its completed executions.
 *
 * - `unfulfilled`        — fulfilled_qar === 0
 * - `partially_fulfilled`— 0 < fulfilled_qar < parent_qar_amount
 * - `fully_fulfilled`    — fulfilled_qar === parent_qar_amount
 */
export type FulfillmentStatus =
  | 'unfulfilled'
  | 'partially_fulfilled'
  | 'fully_fulfilled';

/**
 * Aggregated summary of a parent order computed from its child executions.
 * Produced by `computeParentSummary`.
 */
export interface ParentOrderSummary {
  /** FK → customer_orders.id */
  parent_order_id: string;
  /** Total order amount in QAR (the "target" amount). */
  parent_qar_amount: number;
  /** Sum of sold_qar_amount for all completed executions. */
  fulfilled_qar: number;
  /** parent_qar_amount − fulfilled_qar. Always >= 0. */
  remaining_qar: number;
  /** Sum of egp_received_amount for all completed executions. */
  total_egp_received: number;
  /** Count of completed executions. */
  fill_count: number;
  /** (fulfilled_qar / parent_qar_amount) × 100. Range: [0, 100]. */
  progress_percent: number;
  /**
   * Weighted average FX rate: total_egp_received / fulfilled_qar.
   * null when fill_count === 0 (no completed executions yet).
   * Never a simple average of individual rates.
   */
  weighted_avg_fx: number | null;
  /** Derived fulfillment state. */
  fulfillment_status: FulfillmentStatus;
  /** All child executions for this parent, ordered by sequence_number ascending. */
  executions: OrderExecution[];
}

// ── Phase 4: Cash Destination on Acceptance ──────────────────────────

/**
 * Payload sent to the `respondSharedOrder` RPC when a customer approves an order.
 * `destination_cash_account_id` is required and must be non-null.
 */
export interface OrderAcceptancePayload {
  order_id: string;
  actor_role: 'customer';
  action: 'approve';
  /** The cash account that will receive the EGP proceeds. */
  destination_cash_account_id: string;
}

/**
 * Result returned by `validateCashAccountForAcceptance`.
 *
 * Failure reasons:
 * - `no_account_selected`  — accountId is null or empty
 * - `wrong_owner`          — account not found in the user's account list
 * - `currency_mismatch`    — account currency ≠ order receive currency
 * - `account_disabled`     — account status ≠ 'active'
 */
export interface CashAccountValidationResult {
  valid: boolean;
  reason?: 'no_account_selected' | 'wrong_owner' | 'currency_mismatch' | 'account_disabled';
}

// ── Phase 6: Mobile Install Prompt ───────────────────────────────────

/**
 * Current state of the mobile install prompt for this session.
 *
 * - `not_applicable` — already installed (PWA or native) or not a mobile browser
 * - `pending`        — should show the install prompt
 * - `dismissed`      — user dismissed; suppress for the remainder of the session
 */
export type InstallPromptState =
  | 'not_applicable'
  | 'pending'
  | 'dismissed';

/**
 * Detected mobile install context, produced by `detectMobileInstallContext`.
 */
export interface MobileInstallContext {
  /**
   * true iff window.innerWidth < 768 AND the app is not running as a native app.
   */
  isMobileBrowser: boolean;
  /**
   * true iff the app is running as an installed PWA or as a native Capacitor app.
   */
  isInstalled: boolean;
  /**
   * Derived from navigator.userAgent:
   * - 'android' if /android/i matches
   * - 'ios'     if /iphone|ipad|ipod/i matches
   * - 'other'   otherwise
   */
  platform: 'android' | 'ios' | 'other';
  /** Current install prompt state for this session. */
  promptState: InstallPromptState;
  /**
   * true iff a BeforeInstallPromptEvent has been captured and not yet consumed.
   * Only relevant on Android.
   */
  nativePromptAvailable: boolean;
}
