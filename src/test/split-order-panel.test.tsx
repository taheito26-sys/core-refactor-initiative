import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SplitOrderPanel, type SplitLegHandlers, type SplitLegState } from '@/features/orders/components/SplitOrderPanel';

const t = (key: string) => key;
const leg = (over: Partial<SplitLegState> = {}): SplitLegState => ({
  buyerText: '', buyerId: '', qty: '', sellPrice: '3.7', isLoan: false, cashMode: 'none', cashAmount: '', cashAccountId: '', ...over,
});
const handlers = (): SplitLegHandlers => ({
  onBuyerText: vi.fn(), onBuyerPick: vi.fn(), onQty: vi.fn(), onSellPrice: vi.fn(), onLoan: vi.fn(),
  onCashMode: vi.fn(), onCashAmount: vi.fn(), onCashAccount: vi.fn(),
});

function setup(over: { legs?: [SplitLegState, SplitLegState]; registered?: number; total?: number } = {}) {
  const a = handlers();
  const b = handlers();
  const onEven = vi.fn();
  const onSwap = vi.fn();
  render(
    <SplitOrderPanel
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      t={t as any}
      total={over.total ?? 100}
      registeredUsdt={over.registered}
      fee={10}
      legs={over.legs ?? [leg({ qty: '60', buyerText: 'Sherif' }), leg({ qty: '40', sellPrice: '3.8' })]}
      handlers={[a, b]}
      options={[{ id: 'c1', name: 'Mohamed Al-Damrawy', phone: '+974 7' }, { id: 'c2', name: 'Hatem' }]}
      cashAccounts={[{ id: 'acc', name: 'Hand cash', balance: 100 }]}
      fmtMoney={n => n.toFixed(2)}
      fmtQty={n => String(n)}
      currencyLabel="QAR"
      onEven={onEven}
      onSwap={onSwap}
    />,
  );
  return { a, b, onEven, onSwap };
}

describe('SplitOrderPanel', () => {
  it('shows both halves with the same options: loan, cash and price on each', () => {
    setup();
    expect(screen.getAllByText('splitQtyLabel')).toHaveLength(2);
    expect(screen.getAllByText('splitPriceLabel')).toHaveLength(2);
    expect(screen.getAllByText(/loanSaleCheckbox/)).toHaveLength(2);
    expect(screen.getAllByText('addSaleProceedsToCash')).toHaveLength(2);
  });

  it('computes each half\'s total from its own quantity and price', () => {
    setup();
    expect(screen.getByText('222.00')).toBeTruthy(); // 60 x 3.7
    expect(screen.getByText('152.00')).toBeTruthy(); // 40 x 3.8
    expect(screen.getByText('374.00')).toBeTruthy(); // both together
  });

  it('divides the fee between the halves rather than copying it', () => {
    setup();
    expect(screen.getByText('6.00')).toBeTruthy();
    expect(screen.getByText('4.00')).toBeTruthy();
  });

  it('routes edits to the half they were made on', () => {
    const { a, b } = setup();
    const qtyInputs = screen.getAllByDisplayValue(/^(60|40)$/);
    fireEvent.change(qtyInputs[0], { target: { value: '70' } });
    expect(a.onQty).toHaveBeenCalledWith('70');
    expect(b.onQty).not.toHaveBeenCalled();
    fireEvent.change(qtyInputs[1], { target: { value: '25' } });
    expect(b.onQty).toHaveBeenCalledWith('25');
  });

  it('turns the loan switch on for the second half independently of the first', () => {
    const { a, b } = setup();
    const boxes = screen.getAllByRole('checkbox');
    fireEvent.click(boxes[1]);
    expect(b.onLoan).toHaveBeenCalledWith(true);
    expect(a.onLoan).not.toHaveBeenCalled();
  });

  it('shows what each loaned half owes under that customer\'s name', () => {
    setup({ legs: [leg({ qty: '60', buyerText: 'Sherif', isLoan: true }), leg({ qty: '40', sellPrice: '3.8', buyerText: 'Damrawy', isLoan: true })] });
    expect(screen.getByText(/Sherif splitOwes/)).toBeTruthy();
    expect(screen.getByText(/Damrawy splitOwes/)).toBeTruthy();
    expect(screen.getByText('216.00 QAR')).toBeTruthy(); // 60 x 3.7 less its 6.00 fee share
    expect(screen.getByText('148.00 QAR')).toBeTruthy(); // 40 x 3.8 less its 4.00 fee share
  });

  it('offers matching customers while typing and picks one', () => {
    const { b } = setup({ legs: [leg({ qty: '60', buyerText: 'Sherif' }), leg({ qty: '40', buyerText: 'dam' })] });
    const inputs = screen.getAllByPlaceholderText('splitCustomerSearch');
    fireEvent.focus(inputs[1]);
    fireEvent.mouseDown(screen.getByText('Mohamed Al-Damrawy'));
    expect(b.onBuyerPick).toHaveBeenCalledWith(expect.objectContaining({ id: 'c1' }));
  });

  it('wires the even-split and swap buttons', () => {
    const { onEven, onSwap } = setup();
    fireEvent.click(screen.getByText('splitEvenButton'));
    fireEvent.click(screen.getByText(/splitSwapButton/));
    expect(onEven).toHaveBeenCalled();
    expect(onSwap).toHaveBeenCalled();
  });

  it('keeps the whole exchange order in view when part of it is already registered', () => {
    setup({ registered: 1802, total: 2950.85, legs: [leg({ qty: '1148.85', buyerText: 'Sherif' }), leg({ qty: '1802', buyerText: 'Damrawy' })] });
    expect(screen.getByText('4752.85 USDT')).toBeTruthy(); // 1802 registered + 2950.85 to allocate
    expect(screen.getByText('−1802 USDT')).toBeTruthy();
    expect(screen.getByText(/splitToAllocate/)).toBeTruthy();
  });

  it('has no editable order total: the only inputs are each half\'s customer, quantity and price', () => {
    setup({ registered: 1802, total: 2950.85 });
    expect(screen.getAllByRole('textbox')).toHaveLength(6);
    expect(screen.getByText(/splitToAllocate/)).toBeTruthy();
  });
});
