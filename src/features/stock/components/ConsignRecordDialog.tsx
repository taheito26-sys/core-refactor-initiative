import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useT } from '@/lib/i18n';
import { fmtTotal, uid, type TrackerState } from '@/lib/tracker-helpers';
import { ConsignmentError } from '../consignment';
import { consignFromRecord, openConsignmentsFor, returnFromRecord } from '../consignment-sources';
import { computeFIFO } from '@/lib/tracker-helpers';
import { loanSourceAmount, loanSourceCanSplit, type LoanSource } from '../loan-ledger';
import { useBorrowLendCommit } from '../hooks/useBorrowLendCommit';
import { useLoanMerchantNames } from '../hooks/useLoanMerchantNames';
import { useMerchantConsignmentActions } from '../hooks/useMerchantConsignments';
import type { TagResult } from '../usdt-tagging';

const MANUAL = '__manual__';
const num = (s: string) => Number(String(s).replace(/,/g, ''));

/**
 * Classifies one exchange record that is not yet registered as a consignment:
 * outgoing USDT sent to a merchant to sell ('send'), or incoming USDT that is
 * the unsold part of a consignment coming back ('return', at its original cost).
 * Either way the record leaves "needs a decision", and goes back on undo.
 */
export function ConsignRecordDialog({
  mode,
  source,
  counterparty,
  state,
  applyStateAndCommit,
  onClose,
}: {
  mode: 'send' | 'return';
  source: LoanSource;
  /** The counterparty the exchange reported, used to preselect the merchant or consignment. */
  counterparty?: string | null;
  state: TrackerState;
  applyStateAndCommit: (next: TrackerState) => Promise<void>;
  onClose: () => void;
}) {
  const t = useT();
  const { commit, busy } = useBorrowLendCommit(applyStateAndCommit);
  const { create, report } = useMerchantConsignmentActions();
  const merchants = useLoanMerchantNames(state);
  const connected = merchants.filter(m => m.connected && m.relationshipId);
  const available = loanSourceAmount(source);
  const canSplit = loanSourceCanSplit(source);
  const open = useMemo(() => openConsignmentsFor(state, counterparty), [state, counterparty]);

  const [merchant, setMerchant] = useState('');
  const [manualName, setManualName] = useState('');
  const [share, setShare] = useState('50');
  const [amount, setAmount] = useState(String(available));
  const [pick, setPick] = useState(open[0]?.id || '');
  const [working, setWorking] = useState(false);

  useEffect(() => {
    if (merchant) return;
    const key = String(counterparty || '').trim().toLowerCase();
    const hit = connected.find(m => m.name.trim().toLowerCase() === key);
    if (hit) setMerchant(hit.relationshipId as string);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected.length]);

  const fail = (err: unknown) => {
    if (err instanceof ConsignmentError) {
      toast.error(t(err.code === 'insufficient_stock' ? 'consInsufficientStock' : err.code === 'exceeds_open' ? 'consBadQty' : 'mloanErrAmount'));
    } else {
      console.error('[consign-record]', err);
      toast.error(t('mloanSaveFailed'));
    }
  };

  const qty = canSplit ? num(amount) : available;
  const qtyOk = qty > 0 && qty <= available + 1e-6;
  const picked = open.find(c => c.id === pick);

  const save = async () => {
    if (!qtyOk) return toast.error(t('mloanErrAmount'));
    setWorking(true);
    try {
      let result: TagResult;
      if (mode === 'send') {
        const linked = connected.find(m => m.relationshipId === merchant);
        const name = linked?.name || manualName.trim();
        if (!name) return toast.error(t('mloanErrName'));
        const id = uid();
        const sharePct = num(share);
        let remoteId: string | undefined;
        let local = consignFromRecord(state, source, { id, counterpartyName: name, relationshipId: linked?.relationshipId, profitSharePct: sharePct, amount: qty });
        if (linked) {
          // The agreed cost is what this USDT left stock at, so both merchants split the same profit.
          const calc = computeFIFO(local.state.batches, local.state.trades, local.state.usdtTransfers).transferCalc.get(id);
          remoteId = await create.mutateAsync({
            relationshipId: linked.relationshipId as string, qty, basePrice: calc?.unitCost || 0, senderSharePct: sharePct, trackerRef: id, clientRequestId: id,
          });
          local = consignFromRecord(state, source, { id, counterpartyName: name, relationshipId: linked.relationshipId, remoteId, profitSharePct: sharePct, amount: qty });
        }
        result = local;
      } else {
        if (!picked) return toast.error(t('consPickConsignment'));
        const id = uid();
        let remoteEventId: string | undefined;
        const remoteConsignment = (state.usdtTransfers || []).find(x => x.id === picked.id)?.consignment?.remoteId;
        if (remoteConsignment) {
          // The merchant confirms the return; the record is already booked here so it cannot be used twice.
          remoteEventId = await report.mutateAsync({ consignmentId: remoteConsignment, kind: 'return', qty, clientRequestId: id });
        }
        result = returnFromRecord(state, source, { consignmentId: picked.id, returnId: id, amount: qty, remoteEventId });
      }
      if (await commit(result, 'consSaved')) onClose();
    } catch (err) {
      fail(err);
    } finally {
      setWorking(false);
    }
  };

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="tracker-root" dir={t.isRTL ? 'rtl' : 'ltr'}>
        <DialogTitle>{t(mode === 'send' ? 'consFromRecordTitle' : 'consReturnFromRecordTitle')}</DialogTitle>
        <DialogDescription>{t(mode === 'send' ? 'consFromRecordHint' : 'consReturnFromRecordHint')}</DialogDescription>
        <div className="space-y-3">
          <div className="text-sm font-semibold">{fmtTotal(available)} USDT{counterparty ? ` · ${counterparty}` : ''}</div>

          {mode === 'send' ? (
            <>
              <label className="flex flex-col gap-1 text-xs font-medium">
                {t('consMerchant')}
                <select className="h-10 rounded-md border bg-background px-2 text-sm" aria-label={t('consMerchant')} value={merchant} onChange={e => setMerchant(e.target.value)}>
                  <option value="">{t('consPickMerchant')}</option>
                  {connected.length > 0 && (
                    <optgroup label={t('consConnectedMerchants')}>
                      {connected.map(m => <option key={m.relationshipId} value={m.relationshipId}>{m.name}</option>)}
                    </optgroup>
                  )}
                  <option value={MANUAL}>{t('consAddManualMerchant')}</option>
                </select>
              </label>
              {merchant === MANUAL && (
                <Input aria-label={t('consManualMerchantName')} placeholder={t('consManualMerchantName')} value={manualName} onChange={e => setManualName(e.target.value)} />
              )}
              <p className="text-xs text-muted-foreground">{t(connected.some(m => m.relationshipId === merchant) ? 'consConnectedSync' : 'consManualSync')}</p>
              <label className="flex flex-col gap-1 text-xs font-medium">
                {t('consMyShare')}
                <Input className="w-28" inputMode="decimal" value={share} onChange={e => setShare(e.target.value)} />
              </label>
            </>
          ) : open.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('consNoOpenToReturn')}</p>
          ) : (
            <label className="flex flex-col gap-1 text-xs font-medium">
              {t('consWhichConsignment')}
              <select className="h-10 rounded-md border bg-background px-2 text-sm" aria-label={t('consWhichConsignment')} value={pick} onChange={e => setPick(e.target.value)}>
                {open.map(c => <option key={c.id} value={c.id}>{c.counterpartyName} · {fmtTotal(c.open)} {t('consWithMerchant')}</option>)}
              </select>
            </label>
          )}

          {canSplit && (
            <label className="flex flex-col gap-1 text-xs font-medium">
              {t('consQty')}
              <Input className="w-36" inputMode="decimal" aria-label={t('consQty')} value={amount} onChange={e => setAmount(e.target.value)} />
              <span className="font-normal text-muted-foreground">{t('consUpTo').split('{x}').join(fmtTotal(available))}</span>
            </label>
          )}
          {mode === 'return' && picked && <p className="text-xs text-muted-foreground">{t('consReturnAtCost')}</p>}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>{t('cancel')}</Button>
          <Button disabled={busy || working || !qtyOk || (mode === 'return' && !picked)} onClick={() => { void save(); }}>{t('consSave')}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
