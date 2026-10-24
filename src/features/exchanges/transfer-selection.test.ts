import { describe, expect, it } from 'vitest';
import { summarizeTransferSelection } from './transfer-selection';

describe('stock transfer selection', () => {
  const transfers = [
    { amount: 1755.83925827, asset: 'USDT', kind: 'pay', counterparty: null },
    { amount: 2000, asset: 'USDT', kind: 'pay', counterparty: 'BU_TAMIM' },
    { amount: 8000, asset: 'USDT', kind: 'pay', counterparty: '-Zack-' },
  ];
  it('combines all selected quantities even with different or missing senders', () => {
    expect(summarizeTransferSelection(transfers)).toEqual({ total: 11755.83925827, sameSender: false, canCombine: true });
    expect(summarizeTransferSelection(transfers.slice(0, 2)).total).toBe(3755.83925827);
  });
  it('keeps incompatible assets and transfer types separate', () => {
    expect(summarizeTransferSelection([transfers[0], { ...transfers[1], asset: 'BTC' }]).canCombine).toBe(false);
    expect(summarizeTransferSelection([transfers[0], { ...transfers[1], kind: 'deposit' }]).canCombine).toBe(false);
    expect(summarizeTransferSelection([]).canCombine).toBe(false);
  });
});
