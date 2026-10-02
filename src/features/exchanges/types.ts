export type ExchangeId = 'binance' | 'okx';

export const EXCHANGE_LABELS: Record<ExchangeId, string> = {
  binance: 'Binance',
  okx: 'OKX',
};

export interface ExchangeCredential {
  id: string;
  exchange: ExchangeId;
  label: string | null;
  api_key: string;
  last_synced_at: string | null;
  last_sync_error: string | null;
  created_at: string;
}

export interface ExchangeBalance {
  id: string;
  exchange: ExchangeId;
  account_type: 'spot' | 'funding';
  asset: string;
  free: number;
  locked: number;
  updated_at: string;
}

/**
 * Why a record was taken out of "needs a decision" without being registered:
 * ignored (skip it), deleted (remove it from the app), or adjusted (the stock
 * was corrected by hand instead). All three are restorable.
 */
export type ExchangeDismissReason = 'ignored' | 'deleted' | 'adjusted';

export interface ExchangeP2POrder {
  id: string;
  exchange: ExchangeId;
  order_number: string;
  side: 'buy' | 'sell';
  asset: string;
  fiat: string;
  amount: number;
  price: number;
  total: number;
  status: string;
  counterparty: string | null;
  order_time: string | null;
  linked_entity_type: 'batch' | 'trade' | null;
  linked_entity_id: string | null;
  linked_at: string | null;
  /** Set when the merchant resolved this order without registering it (see ExchangeDismissReason). */
  dismissed_at?: string | null;
  dismiss_reason?: ExchangeDismissReason | null;
  dismiss_note?: string | null;
  /** The exchange's own record, exactly as returned. */
  raw?: Record<string, unknown> | null;
  created_at: string;
}

// Status vocabulary differs by exchange (Binance's C2C API vs. OKX's), so
// this is a blocklist rather than an allowlist of one known-good string —
// anything that plainly isn't a finished trade (cancelled, still pending,
// under appeal, failed, expired) is excluded; unrecognized-but-plausible
// statuses stay visible rather than getting silently hidden.
const NON_COMPLETED_P2P_STATUS_PATTERN = /cancel|pending|appeal|fail|expire|reject/i;

export function isCompletedP2POrder(status: string): boolean {
  return !NON_COMPLETED_P2P_STATUS_PATTERN.test(status);
}

export interface ExchangeTransfer {
  id: string;
  exchange: ExchangeId;
  /** 'pay' = Binance Pay / OKX internal transfer, 'network' = on-chain. */
  kind: 'pay' | 'network';
  direction: 'in' | 'out';
  asset: string;
  amount: number;
  status: string;
  reference: string;
  counterparty: string | null;
  network: string | null;
  transfer_time: string | null;
  linked_entity_type: 'batch' | 'trade' | null;
  linked_entity_id: string | null;
  linked_at: string | null;
  /** Set when the merchant marked this transfer as "not an order" (e.g. a loan repayment received via Pay) — hidden from the inbox, never imported. */
  dismissed_at: string | null;
  dismiss_reason?: ExchangeDismissReason | null;
  dismiss_note?: string | null;
  /** The exchange's own record, exactly as returned. */
  raw?: Record<string, unknown> | null;
  created_at: string;
}
