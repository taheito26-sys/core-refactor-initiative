import { useMemo, useState } from 'react';
import type { CreateMarketOfferInput, MarketOfferType } from '../types';

interface Props {
  roomId: string;
  onSubmit: (input: CreateMarketOfferInput) => Promise<void> | void;
  isSubmitting?: boolean;
}

const PAYMENT_METHOD_PRESETS = ['Bank transfer', 'Cash pickup', 'QNB', 'CBQ', 'PayPal'];

export function MarketOfferComposer({ roomId, onSubmit, isSubmitting = false }: Props) {
  const [offerType, setOfferType] = useState<MarketOfferType>('buy');
  const [amount, setAmount] = useState('');
  const [price, setPrice] = useState('');
  const [notes, setNotes] = useState('');
  const [paymentMethods, setPaymentMethods] = useState<string[]>(['Bank transfer']);

  const canSubmit = useMemo(() => Number(amount) > 0 && Number(price) > 0, [amount, price]);

  const toggleMethod = (method: string) => {
    setPaymentMethods((current) =>
      current.includes(method)
        ? current.filter((item) => item !== method)
        : [...current, method],
    );
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    await onSubmit({
      roomId,
      offerType,
      amount: Number(amount),
      price: Number(price),
      paymentMethods,
      notes: notes.trim() || null,
    });
    setAmount('');
    setPrice('');
    setNotes('');
  };

  return (
    <div className="border-b border-border/50 bg-card/90 px-3 py-3">
      <div className="flex flex-col gap-3 rounded-2xl border border-border/50 bg-background/70 p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Qatar Market Offer</p>
            <p className="text-xs text-muted-foreground">Post a structured Buy/Sell USDT card into the room.</p>
          </div>
          <div className="flex rounded-xl bg-muted p-1">
            {(['buy', 'sell'] as MarketOfferType[]).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setOfferType(type)}
                className={`rounded-lg px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.14em] transition-colors ${
                  offerType === type ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground'
                }`}
              >
                {type}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-foreground">Amount (USDT)</span>
            <input
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              inputMode="decimal"
              placeholder="25000"
              className="rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none ring-0 transition-shadow focus:border-primary/50 focus:shadow-sm"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-foreground">Rate (QAR)</span>
            <input
              value={price}
              onChange={(event) => setPrice(event.target.value)}
              inputMode="decimal"
              placeholder="3.64"
              className="rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none ring-0 transition-shadow focus:border-primary/50 focus:shadow-sm"
            />
          </label>
        </div>

        <div className="flex flex-wrap gap-2">
          {PAYMENT_METHOD_PRESETS.map((method) => {
            const selected = paymentMethods.includes(method);
            return (
              <button
                key={method}
                type="button"
                onClick={() => toggleMethod(method)}
                className={`rounded-full border px-3 py-1.5 text-[11px] font-semibold transition-colors ${
                  selected
                    ? 'border-primary/40 bg-primary/10 text-primary'
                    : 'border-border bg-background text-muted-foreground'
                }`}
              >
                {method}
              </button>
            );
          })}
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold text-foreground">Notes</span>
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={2}
            placeholder="Settlement window, preferred payment route, minimum clip size..."
            className="resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none transition-shadow focus:border-primary/50 focus:shadow-sm"
          />
        </label>

        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] text-muted-foreground">Asset fixed to USDT / QAR for the permanent Qatar market room.</p>
          <button
            type="button"
            disabled={!canSubmit || isSubmitting}
            onClick={handleSubmit}
            className="rounded-xl bg-primary px-4 py-2 text-[11px] font-bold uppercase tracking-[0.14em] text-primary-foreground transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting ? 'Posting...' : `Post ${offerType}`}
          </button>
        </div>
      </div>
    </div>
  );
}
