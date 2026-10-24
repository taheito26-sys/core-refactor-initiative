/** Summarize compatible transfers without requiring them to share a sender. */
export function summarizeTransferSelection(transfers: Array<{ amount: number; asset: string; kind: string; counterparty?: string | null }>) {
  return {
    total: transfers.reduce((sum, transfer) => sum + transfer.amount, 0),
    sameSender: new Set(transfers.map(transfer => transfer.counterparty?.trim() ?? '')).size === 1,
    canCombine: transfers.length > 0 && transfers.every(transfer => Number.isFinite(transfer.amount) && transfer.amount > 0)
      && new Set(transfers.map(transfer => transfer.asset)).size === 1
      && transfers[0].asset === 'USDT'
      && new Set(transfers.map(transfer => transfer.kind)).size === 1,
  };
}
