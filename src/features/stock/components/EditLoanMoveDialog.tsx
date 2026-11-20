import { useState } from 'react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useT } from '@/lib/i18n';
import { num, type TrackerState } from '@/lib/tracker-helpers';
import type { UsdtTransfer } from '@/lib/usdt-transfers';
import { editLoanMove } from '../loan-ledger';

const toInput = (ts: number) => {
  const d = new Date(ts);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

/** Corrects the amount, date or note of a loan movement typed by hand. Anything tied to a record or a merchant is undone and re-recorded instead. */
export function EditLoanMoveDialog({
  transfer,
  state,
  onSave,
  onClose,
}: {
  transfer: UsdtTransfer;
  state: TrackerState;
  onSave: (next: TrackerState) => Promise<boolean>;
  onClose: () => void;
}) {
  const t = useT();
  const [amount, setAmount] = useState(String(transfer.amountUSDT));
  const [when, setWhen] = useState(toInput(transfer.ts));
  const [note, setNote] = useState(transfer.note || '');
  const [busy, setBusy] = useState(false);

  const ts = new Date(when).getTime();
  const future = Number.isFinite(ts) && ts > Date.now() + 60_000;
  const valid = num(amount, 0) > 0 && Number.isFinite(ts) && !future;

  const save = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      const next = editLoanMove(state, transfer.id, { amountUSDT: num(amount, 0), ts, note });
      if (await onSave(next)) onClose();
    } catch {
      toast.error(t('mloanSaveFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="tracker-root" dir={t.isRTL ? 'rtl' : 'ltr'}>
        <DialogTitle>{t('loansEditMove')}</DialogTitle>
        <DialogDescription>{t('loansEditHint')}</DialogDescription>
        <div className="space-y-3">
          <label className="flex flex-col gap-1 text-xs font-medium">
            {t('mloanAmount')}
            <Input inputMode="decimal" aria-label={t('mloanAmount')} value={amount} onChange={e => setAmount(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium">
            {t('dateTime')}
            <input
              type="datetime-local" max={toInput(Date.now())} aria-label={t('dateTime')} value={when} onChange={e => setWhen(e.target.value)}
              className="h-10 rounded-md border bg-background px-2 text-sm"
            />
          </label>
          {future && <p className="text-xs text-destructive">{t('mloanErrFuture')}</p>}
          <label className="flex flex-col gap-1 text-xs font-medium">
            {t('note')}
            <Input aria-label={t('note')} value={note} onChange={e => setNote(e.target.value)} />
          </label>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>{t('cancel')}</Button>
          <Button disabled={busy || !valid} onClick={() => { void save(); }}>{t('consSave')}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
