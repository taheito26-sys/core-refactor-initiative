// Parent Order Fulfillment Types

export type ExecutionStatus = 'completed' | 'pending' | 'cancelled' | 'failed';
export type MarketType = 'instapay_v1' | 'p2p' | 'bank' | 'manual';
export type FulfillmentStatus = 'unfulfilled' | 'partially_fulfilled' | 'fully_fulfilled';

export interface OrderExecution {
  id: string;
  parent_order_id: string;
  sequence_number: number;
  sold_qar_amount: number;
  fx_rate_qar_to_egp: number;
  egp_received_amount: number;
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
  fulfilled_qar: number;
  remaining_qar: number;
  total_egp_received: number;
  fill_count: number;
  progress_percent: number;
  weighted_avg_fx: number | null;
  fulfillment_status: FulfillmentStatus;
}
