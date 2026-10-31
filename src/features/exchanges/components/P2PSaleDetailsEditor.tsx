import { useId, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { setTransferSaleDetails } from '../api';
import type { ExchangeTransfer } from '../types';

/** Inline form for the sell price and buyer of an OKX P2P entry, which OKX does not report. */
export function P2PSaleDetailsEditor({
  transfer,
  customerNames,
  onClose,
}: {
  transfer: ExchangeTransfer;
  customerNames: string[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const listId = useId();
  const [price, setPrice] = useState(transfer.sale_price_qar ? String(transfer.sale_price_qar) : '');
  const [customer, setCustomer] = useState(transfer.sale_customer_name ?? '');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const parsed = price.trim() ? Number(price) : null;
    if (parsed !== null && (!Number.isFinite(parsed) || parsed <= 0)) {
      toast.error('Enter a sell price above zero, or leave it empty');
      return;
    }
    setSaving(true);
    try {
      await setTransferSaleDetails(transfer.id, { price: parsed, customer });
      await queryClient.invalidateQueries({ queryKey: ['exchange-transfers'] });
      onClose();
    } catch {
      toast.error('Could not save the price and customer');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded border border-dashed bg-muted/20 p-1.5">
      <Input
        inputMode="decimal"
        value={price}
        onChange={(e) => setPrice(e.target.value)}
        placeholder="Sell price (QAR)"
        aria-label="Sell price in QAR"
        className="h-7 w-32 text-xs"
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
