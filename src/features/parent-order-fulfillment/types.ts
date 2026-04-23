// Parent Order Fulfillment Types — USDT-based phased order model

export type ExecutionStatus = 'completed' | 'pending' | 'cancelled' | 'failed';
export type MarketType = 'instapay_v1' | 'p2p' | 'bank' | 'manual';
export type FulfillmentStatus = 'unfulfilled' | 'partially_fulfilled' | 'fully_fulfilled';

export interface OrderExecution {
  id: string;
  parent_order_id: string;
  sequence_number: number;
  // Legacy QAR-based columns (kept for backward compat)
  sold_qar_amount: number;
  fx_rate_qar_to_egp: number;
  egp_received_amount: number;
  // USDT-based phase snapshot columns
  executed_egp: number;
  egp_per_usdt: number;
  phase_usdt: number;
  phase_consumed_qar: number;
  phase_qar_egp_fx: number;
  // Common
  market_type: MarketType;
  cash_account_id: string | null;
  status: ExecutionStatus;
  executed_at: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface ParentOrderSummary {
  parent_order_id: string;
  parent_qar_amount: number;
  usdt_qar_rate: number | null;
  required_usdt: number | null;
  // USDT-based progress
  total_fulfilled_usdt: number;
  remaining_usdt: number;
  // QAR/EGP aggregates (derived from phase snapshots)
  fulfilled_qar: number;
  remaining_qar: number;
  total_egp_received: number;
  fill_count: number;
  progress_percent: number;
  weighted_avg_fx: number | null;
  fulfillment_status: FulfillmentStatus;
}

export interface CashAccount {
  id: string;
  user_id: string;
  name: string;
  currency: string;
  type: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface CashAccountValidationResult {
  valid: boolean;
  reason?: 'no_account_selected' | 'wrong_owner' | 'currency_mismatch' | 'account_disabled';
}
