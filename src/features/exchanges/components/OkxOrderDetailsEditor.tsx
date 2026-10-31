import { useId, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { setOrderSaleDetails } from '../api';
import type { ExchangeP2POrder } from '../types';

const FIATS = ['QAR', 'EGP'] as const;

/** Inline form for the fiat, price and buyer of an OKX P2P order, which OKX does not report. */
export function OkxOrderDetailsEditor({
  order,
  customerNames,
  onClose,
}: {
  order: ExchangeP2POrder;
  customerNames: string[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const listId = useId();
  const [fiat, setFiat] = useState(order.fiat || 'QAR');
  const [price, setPrice] = useState(order.price > 0 ? String(order.price) : '');
  const [customer, setCustomer] = useState(order.counterparty ?? '');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const parsed = Number(price);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      toast.error('Enter the price per USDT');
      return;
    }
    setSaving(true);
    try {
      await setOrderSaleDetails(order, { fiat, price: parsed, customer });
      await queryClient.invalidateQueries({ queryKey: ['exchange-p2p-orders'] });
      onClose();
    } catch {
      toast.error('Could not save the price and customer');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded border border-dashed bg-muted/20 p-1.5">
      <select
        value={fiat}
        onChange={(e) => setFiat(e.target.value)}
        aria-label="Fiat currency"
        className="h-7 rounded border bg-background px-1 text-xs"
      >
        {FIATS.map((f) => <option key={f} value={f}>{f}</option>)}
      </select>
      <Input
        inputMode="decimal"
        value={price}
        onChange={(e) => setPrice(e.target.value)}
        placeholder={`Price per USDT (${fiat})`}
        aria-label="Price per USDT"
        className="h-7 w-36 text-xs"
      />
      <Input
        list={listId}
        value={customer}
        onChange={(e) => setCustomer(e.target.value)}
        placeholder="Customer"
        aria-label="Customer"
        className="h-7 min-w-32 flex-1 text-xs"
      />
      <datalist id={listId}>
        {customerNames.map((name) => <option key={name} value={name} />)}
      </datalist>
      <Button type="button" size="sm" className="h-7 px-2 text-xs" disabled={saving} onClick={() => void save()}>Save</Button>
      <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={saving} onClick={onClose}>Cancel</Button>
    </div>
  );
}
