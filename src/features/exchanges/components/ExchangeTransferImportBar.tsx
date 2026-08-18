import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, ArrowDownToLine } from 'lucide-react';
import { useExchangeTransfers } from '../hooks/useExchangeTransfers';
import { EXCHANGE_LABELS } from '../types';

export interface ExchangeTransferPayload {
  exchange: 'binance' | 'okx';
  transferId: string;
  reference: string;
  kind: 'pay' | 'network';
  amountUSDT: number;
  /** Cost basis the user supplies -- a transfer carries no fiat price. */
  buyPrice: number;
  ts: number;
}

const KIND_LABEL: Record<'pay' | 'network', string> = {
  pay: 'Pay',
  network: 'Network',
};

/**
 * USDT that arrived via Binance Pay / OKX internal transfer or on-chain is
 * inventory too, but unlike a P2P buy it has no fiat price attached. So this
 * bar can't be a blind one-click import -- it collects a cost basis once and
 * applies it to every selected transfer.
 */
export function ExchangeTransferImportBar({
  onImportMany,
  fiatLabel,
  defaultPrice,
}: {
  onImportMany: (transfers: ExchangeTransferPayload[]) => Promise<void> | void;
  /** Currency the buy price is entered in, e.g. "QAR". */
  fiatLabel: string;
  /** Prefills the price box -- typically the current weighted-average cost. */
  defaultPrice?: number;
}) {
  const { data: transfers } = useExchangeTransfers();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [price, setPrice] = useState('');

  const pending = useMemo(
    () => (transfers ?? []).filter((tr) => tr.direction === 'in' && !tr.linked_at),
    [transfers],
  );

  if (pending.length === 0) return null;

  const selected = pending.filter((tr) => !excluded.has(tr.id));
  const selectedTotal = selected.reduce((sum, tr) => sum + tr.amount, 0);
  const pendingTotal = pending.reduce((sum, tr) => sum + tr.amount, 0);
  const parsedPrice = parseFloat(price);
  const priceValid = Number.isFinite(parsedPrice) && parsedPrice > 0;

  const openDialog = () => {
    setPrice(defaultPrice && defaultPrice > 0 ? String(Number(defaultPrice.toFixed(4))) : '');
    setOpen(true);
  };

  const runImport = async () => {
    if (!priceValid || selected.length === 0) return;
    setBusy(true);
    try {
      await onImportMany(
        selected.map((tr) => ({
          exchange: tr.exchange,
          transferId: tr.id,
          reference: tr.reference,
          kind: tr.kind,
          amountUSDT: tr.amount,
          buyPrice: parsedPrice,
          ts: tr.transfer_time ? new Date(tr.transfer_time).getTime() : Date.now(),
        })),
      );
      setOpen(false);
      setExcluded(new Set());
    } finally {
      setBusy(false);
    }
  };

  const toggle = (id: string) => {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed px-2.5 py-1.5 text-xs">
        <Badge variant="secondary" className="shrink-0">{pending.length}</Badge>
        <span className="flex-1 truncate text-muted-foreground">
          {pendingTotal.toLocaleString(undefined, { maximumFractionDigits: 2 })} USDT received via Pay/network
        </span>
        <Button size="sm" className="h-7 px-2 text-xs" onClick={openDialog}>
          <ArrowDownToLine className="h-3.5 w-3.5" />
          Add as stock
        </Button>
      </div>

      <Dialog open={open} onOpenChange={(v) => !busy && setOpen(v)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add received USDT as stock</DialogTitle>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label className="text-xs">Buy price ({fiatLabel} per USDT)</Label>
            <Input
              autoFocus
              inputMode="decimal"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder={`Cost basis in ${fiatLabel}`}
            />
            <p className="text-xs text-muted-foreground">
              Transfers carry no fiat price, so this cost basis is applied to every selected transfer.
            </p>
          </div>

          <ScrollArea className="max-h-[40vh] pr-3">
            <div className="space-y-1.5">
              {pending.map((tr) => (
                <div key={tr.id} className="flex items-center gap-2 rounded bg-muted/40 px-2 py-1.5 text-xs">
                  <Checkbox
                    checked={!excluded.has(tr.id)}
                    onCheckedChange={() => toggle(tr.id)}
                    aria-label={`Include transfer ${tr.reference}`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">
                      {tr.amount.toLocaleString(undefined, { maximumFractionDigits: 8 })} {tr.asset}
                    </div>
                    <div className="truncate text-muted-foreground">
                      {EXCHANGE_LABELS[tr.exchange]} · {KIND_LABEL[tr.kind]}
                      {tr.network ? ` (${tr.network})` : ''}
                      {tr.transfer_time ? ` · ${new Date(tr.transfer_time).toLocaleString()}` : ''}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={runImport} disabled={busy || !priceValid || selected.length === 0}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Add {selectedTotal.toLocaleString(undefined, { maximumFractionDigits: 2 })} USDT
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
