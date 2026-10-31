import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useT } from '@/lib/i18n';
import { setOrderSaleDetails } from '../api';
import type { ExchangeP2POrder } from '../types';
import { priceFromTotal, totalFromPrice } from '../okx-order-price';

const FIATS = ['QAR', 'EGP'] as const;

/** One amount is enough: the order already supplies the USDT quantity. */
export function OkxOrderDetailsEditor({ order, onClose }: {
  order: ExchangeP2POrder;
  onClose: () => void;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const savingRef = useRef(false);
  const [fiat, setFiat] = useState(order.price > 0 ? order.fiat || 'EGP' : 'EGP');
  const [mode, setMode] = useState<'total' | 'price'>('total');
  const [total, setTotal] = useState(order.price > 0 && order.total > 0 ? String(order.total) : '');
  const [price, setPrice] = useState(order.price > 0 ? String(order.price) : '');
  const [saving, setSaving] = useState(false);

  const changeAmount = (value: string) => {
    if (mode === 'total') {
      setTotal(value);
      const derived = priceFromTotal(Number(value), order.amount);
      setPrice(derived === null ? '' : String(derived));
    } else {
      setPrice(value);
      const derived = totalFromPrice(Number(value), order.amount);
      setTotal(derived === null ? '' : String(derived));
    }
  };
  const valid = Number(price) > 0 && Number(total) > 0 && Number.isFinite(Number(price)) && Number.isFinite(Number(total));

  const save = async () => {
    if (savingRef.current || !valid) return;
    savingRef.current = true;
    setSaving(true);
    try {
      await setOrderSaleDetails(order, {
        fiat, price: Number(price), total: Number(total),
        customer: order.counterparty ?? null,
      });
      await queryClient.invalidateQueries({ queryKey: ['exchange-p2p-orders'] });
      onClose();
    } catch {
      toast.error(t('exchangeAmountSaveFailed'));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <form className="space-y-2 rounded border border-dashed bg-muted/20 p-2" onSubmit={e => { e.preventDefault(); void save(); }}>
      <div className="flex items-center gap-2">
        <select value={fiat} disabled={saving} onChange={e => setFiat(e.target.value)} aria-label={t('exchangeFiatCurrency')} className="h-10 rounded border bg-background px-2 text-sm">
          {FIATS.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
        <Input autoFocus inputMode="decimal" value={mode === 'total' ? total : price} disabled={saving}
          onChange={e => changeAmount(e.target.value)}
          placeholder={`${t(mode === 'total' ? 'exchangeTotalReceived' : 'exchangePricePerUsdt')} (${fiat})`}
          aria-label={t(mode === 'total' ? 'exchangeTotalReceived' : 'exchangePricePerUsdt')}
          className="h-10 min-w-0 flex-1 text-base" />
        <Button type="submit" disabled={saving || !valid} aria-busy={saving} className="h-10 px-3">{t(saving ? 'saving' : 'save')}</Button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="text-muted-foreground" aria-live="polite">
          {valid ? (mode === 'total' ? `${price} ${fiat}/USDT` : `${total} ${fiat}`) : t('exchangeEnterAmount')}
        </span>
        <div className="flex items-center gap-3">
          <button type="button" disabled={saving} className="min-h-8 text-primary underline" onClick={() => setMode(mode === 'total' ? 'price' : 'total')}>
            {t(mode === 'total' ? 'exchangeEnterRateInstead' : 'exchangeEnterTotalInstead')}
          </button>
          <button type="button" disabled={saving} className="min-h-8 text-muted-foreground" onClick={onClose}>{t('cancel')}</button>
        </div>
      </div>
    </form>
  );
}
