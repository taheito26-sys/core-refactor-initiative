import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useAuth } from '@/features/auth/auth-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useT } from '@/lib/i18n';
import { computeFIFO, fmtPrice, fmtTotal, type DerivedState, type TrackerState } from '@/lib/tracker-helpers';
import {
  ConsignmentError,
  consignmentPayables,
  consignmentReceivables,
  consignmentSaleNetDue,
  findConsignment,
  listConsignments,
  recordConsignmentPurchase,
  recordConsignmentReturn,
  recordConsignmentSale,
  recordConsignmentSettlement,
  recordReceivedConsignmentSale,
  recordReceivedConsignmentPurchase,
  recordReceivedConsignmentSettlement,
  sendConsignment,
  undoConsignmentSale,
  undoConsignmentTransfer,
  type ConsignmentSummary,
} from '../consignment';
import {
  useConnectedMerchants,
  useMerchantConsignments,
  type RemoteConsignment,
  type RemoteConsignmentEvent,
} from '../hooks/useMerchantConsignments';

type Kind = 'sale' | 'return' | 'purchase';
interface Draft { target: string; kind: Kind; qty: string; price: string; fundedFromSaleId: string }

const newId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `c${Date.now()}${Math.random().toString(16).slice(2)}`);
const num = (s: string) => Number(String(s).replace(/,/g, ''));

/**
 * USDT sent to another merchant to sell. Sends leave stock at cost; the merchant
 * (or I) report what happened, and a linked merchant confirms it before it is
 * booked, so both trackers carry the same numbers.
 */
export function ConsignmentsPanel({
  state,
  derived,
  applyStateAndCommit,
}: {
  state: TrackerState;
  derived: DerivedState;
  applyStateAndCommit: (next: TrackerState) => Promise<void>;
}) {
  const t = useT();
  const { user } = useAuth();
  const me = user?.id;
  const { data: remote, create, report, respond } = useMerchantConsignments();
  const { data: merchants = [] } = useConnectedMerchants();
  const [form, setForm] = useState({ merchant: '', name: '', qty: '', share: '50' });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);

  const local = useMemo(() => listConsignments(state), [state]);
  const sales = state.trades.filter(x => x.consignment && x.consignment.role !== 'receiver' && !x.voided);
  const remoteByRef = useMemo(() => new Map(remote.consignments.filter(c => c.trackerRef).map(c => [c.trackerRef as string, c])), [remote.consignments]);
  const incoming = remote.consignments.filter(c => !c.iAmSender);
  const eventsOf = (id: string) => remote.events.filter(e => e.consignmentId === id);
  const unitCostOf = (id: string) => {
    const c = derived.transferCalc?.get(id);
    return c && c.coveredQty > 0 ? c.totalCost / c.coveredQty : 0;
  };
  const purchaseSources = (target: string) => {
    const remoteRow = remote.consignments.find(c => c.id === target);
    if (remoteRow) {
      return eventsOf(target)
        .filter(e => e.kind === 'sale' && e.status === 'confirmed')
        .map(e => ({ id: e.id, label: `${fmtTotal(e.qty)} @ ${fmtPrice(e.priceQAR || 0)}` }));
    }
    const localRow = local.find(c => c.id === target);
    if (!localRow) return [];
    return sales
      .filter(s => s.exchangeCounterparty === localRow.counterpartyName && consignmentSaleNetDue(s) > 0)
      .map(s => ({ id: s.id, label: `${fmtTotal(s.amountUSDT)} @ ${fmtPrice(s.sellPriceQAR)}` }));
  };

  // Book every confirmed report exactly once. Each booking is keyed by the
  // report's id, so running this again or from another device changes nothing.
  const applying = useRef(false);
  useEffect(() => {
    if (!me || applying.current) return;
    let next = state;
    for (const c of remote.consignments) {
      for (const e of eventsOf(c.id)) {
        if (e.status !== 'confirmed') continue;
        try {
          if (c.iAmSender && c.trackerRef && findConsignment(next, c.trackerRef)) {
            if (e.kind === 'sale') next = recordConsignmentSale(next, { consignmentId: c.trackerRef, saleId: e.id, qty: e.qty, priceQAR: e.priceQAR || 0, unitCostQAR: c.basePriceQAR }, Date.parse(e.createdAt));
            else if (e.kind === 'return') next = recordConsignmentReturn(next, { consignmentId: c.trackerRef, returnId: e.id, qty: e.qty }, Date.parse(e.createdAt));
            else if (e.kind === 'purchase') next = recordConsignmentPurchase(next, { batchId: e.id, counterpartyName: c.counterpartyName, qty: e.qty, priceQAR: e.priceQAR || 0, fundedFromSaleId: e.fundedFromSaleId || undefined });
            else if (e.kind === 'settlement' && e.fundedFromSaleId) next = recordConsignmentSettlement(next, { saleId: e.fundedFromSaleId, amountQAR: e.amountQAR || 0, settlementId: e.id });
          } else if (!c.iAmSender && e.kind === 'sale') {
            next = recordReceivedConsignmentSale(next, { saleId: e.id, consignmentId: c.id, counterpartyName: c.counterpartyName, qty: e.qty, priceQAR: e.priceQAR || 0, basePriceQAR: c.basePriceQAR, senderSharePct: c.senderSharePct });
          } else if (!c.iAmSender && e.kind === 'purchase' && e.fundedFromSaleId) {
            next = recordReceivedConsignmentPurchase(next, { purchaseId: e.id, saleId: e.fundedFromSaleId, counterpartyName: c.counterpartyName, qty: e.qty, priceQAR: e.priceQAR || 0 });
          } else if (!c.iAmSender && e.kind === 'settlement' && e.fundedFromSaleId) {
            next = recordReceivedConsignmentSettlement(next, { saleId: e.fundedFromSaleId, amountQAR: e.amountQAR || 0, settlementId: e.id });
          }
        } catch (err) {
          if (!(err instanceof ConsignmentError)) console.error('[consignments] booking failed:', err);
        }
      }
    }
    if (next === state) return;
    applying.current = true;
    applyStateAndCommit(next).catch(err => console.error('[consignments] commit failed:', err)).finally(() => { applying.current = false; });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remote, state, me]);

  const fail = (err: unknown) => {
    if (err instanceof ConsignmentError) {
      toast.error(err.code === 'price_below_cost' ? t('consBadPrice') : err.code === 'insufficient_stock' ? t('consInsufficientStock') : err.code === 'exceeds_open' ? t('consBadQty') : t('consFailed'));
    } else {
      console.error('[consignments]', err);
      toast.error(err instanceof Error && err.message ? err.message : t('consFailed'));
    }
  };

  const send = async () => {
    const qty = num(form.qty);
    const share = num(form.share);
    const linked = merchants.find(m => m.relationshipId === form.merchant);
    const name = linked?.name || form.name.trim();
    if (!name || !(qty > 0)) return fail(new ConsignmentError('bad_amount'));
    setBusy(true);
    try {
      const id = newId();
      let next = sendConsignment(state, { id, counterpartyName: name, relationshipId: linked?.relationshipId, qty, profitSharePct: share });
      const { transferCalc } = computeFIFO(next.batches, next.trades, next.usdtTransfers);
      const calc = transferCalc.get(id);
      if (!calc || calc.shortfallQty > 1e-6 || calc.coveredQty < qty - 1e-6 || !(calc.unitCost && calc.unitCost > 0)) {
        throw new ConsignmentError('insufficient_stock');
      }
      const base = calc.unitCost;
      if (linked) {
        // The agreed cost is what this USDT left stock at, so both sides split the same profit.
        const remoteId = await create.mutateAsync({ relationshipId: linked.relationshipId, qty, basePrice: base, senderSharePct: share, trackerRef: id, clientRequestId: id });
        next = sendConsignment(state, { id, counterpartyName: name, relationshipId: linked.relationshipId, qty, profitSharePct: share, remoteId });
      }
      await applyStateAndCommit(next);
      setForm({ merchant: '', name: '', qty: '', share: form.share });
      toast.success(t('consSaved'));
    } catch (err) { fail(err); } finally { setBusy(false); }
  };

  const submitDraft = async () => {
    if (!draft) return;
    const qty = num(draft.qty);
    const price = num(draft.price);
    const mine = local.find(c => c.id === draft.target);
    const theirs = remote.consignments.find(c => c.id === draft.target);
    setBusy(true);
    try {
      const remoteRow = theirs || (mine && remoteByRef.get(mine.id));
      if (remoteRow) {
        // Linked merchant: it is booked on both sides once the other one confirms.
        await report.mutateAsync({
          consignmentId: remoteRow.id,
          kind: draft.kind,
          qty,
          price: draft.kind === 'return' ? undefined : price,
          fundedFromSaleId: draft.kind === 'purchase' ? draft.fundedFromSaleId || undefined : undefined,
          clientRequestId: newId(),
        });
      } else if (mine) {
        const id = newId();
        let next = state;
        if (draft.kind === 'sale') next = recordConsignmentSale(state, { consignmentId: mine.id, saleId: id, qty, priceQAR: price, unitCostQAR: unitCostOf(mine.id) });
        else if (draft.kind === 'return') next = recordConsignmentReturn(state, { consignmentId: mine.id, returnId: id, qty });
        else next = recordConsignmentPurchase(state, { batchId: id, counterpartyName: mine.counterpartyName, qty, priceQAR: price, fundedFromSaleId: draft.fundedFromSaleId || undefined });
        await applyStateAndCommit(next);
      }
      setDraft(null);
      toast.success(t('consSaved'));
    } catch (err) { fail(err); } finally { setBusy(false); }
  };

  const answer = async (e: RemoteConsignmentEvent, accept: boolean) => {
    setBusy(true);
    try { await respond.mutateAsync({ eventId: e.id, accept }); } catch (err) { fail(err); } finally { setBusy(false); }
  };

  const undo = async (fn: () => TrackerState) => {
    try { await applyStateAndCommit(fn()); } catch (err) { fail(err); }
  };

  const receivables = consignmentReceivables(state);
  const payables = consignmentPayables(state);
  const pendingFor = (id: string) => eventsOf(id).filter(e => e.status === 'pending');
  const renderEvents = (id: string) => pendingFor(id).map(e => (
    <div key={e.id} className="flex flex-wrap items-center gap-2 rounded-md bg-muted px-2 py-1 text-xs">
      <span>
        {t(e.kind === 'sale' ? 'consReportSold' : e.kind === 'return' ? 'consReportReturn' : e.kind === 'settlement' ? 'consSettlement' : 'consReportBuy')}
        {e.kind === 'settlement' ? `: ${fmtTotal(e.amountQAR || 0)}` : `: ${fmtTotal(e.qty)}${e.priceQAR ? ` @ ${fmtPrice(e.priceQAR)}` : ''}`}
      </span>
      {e.reportedBy === me
        ? <span className="text-muted-foreground">{t('consPending')}</span>
        : (<>
            <Button size="sm" disabled={busy} onClick={() => answer(e, true)}>{t('consConfirm')}</Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => answer(e, false)}>{t('consReject')}</Button>
          </>)}
    </div>
  ));

  const startDraft = (target: string, kind: Kind) => {
    const sources = kind === 'purchase' ? purchaseSources(target) : [];
    setDraft({ target, kind, qty: '', price: '', fundedFromSaleId: sources[0]?.id || '' });
  };

  const actions = (target: string, disabled: boolean) => (
    <div className="flex flex-wrap gap-2">
      {(['sale', 'return', 'purchase'] as Kind[]).map(k => (
        <Button key={k} size="sm" variant="outline" disabled={disabled}
          onClick={() => startDraft(target, k)}>
          {t(k === 'sale' ? 'consReportSold' : k === 'return' ? 'consReportReturn' : 'consReportBuy')}
        </Button>
      ))}
    </div>
  );

  const draftForm = (target: string) => {
    if (!draft || draft.target !== target) return null;
    const draftPrice = num(draft.price);
    const localRow = local.find(c => c.id === target);
    const remoteRow = remote.consignments.find(c => c.id === target);
    const draftCost = localRow ? unitCostOf(localRow.id) : remoteRow?.basePriceQAR || 0;
    return (
    <div className="space-y-2 rounded-md border p-2">
      {draft.kind === 'purchase' && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">{t('consNewPurchaseHint')}</p>
          {purchaseSources(target).length > 0 ? (
            <select
              className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              value={draft.fundedFromSaleId}
              onChange={e => setDraft({ ...draft, fundedFromSaleId: e.target.value })}
            >
              <option value="">{t('consIndependentPurchase')}</option>
              {purchaseSources(target).map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          ) : (
            <p className="text-xs text-muted-foreground">{t('consNoSaleToFund')}</p>
          )}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Input className="w-36" inputMode="decimal" placeholder={t('consQty')} value={draft.qty} onChange={e => setDraft({ ...draft, qty: e.target.value })} />
        {draft.kind !== 'return' && (
          <Input className="w-40" inputMode="decimal" placeholder={t('consPrice')} value={draft.price} onChange={e => setDraft({ ...draft, price: e.target.value })} />
        )}
        <Button size="sm" disabled={busy} onClick={submitDraft}>{t('consSendBtn')}</Button>
        <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>×</Button>
      </div>
      {draft.kind === 'sale' && draftPrice > 0 && draftCost > 0 && draftPrice < draftCost && (
        <p className="text-xs text-amber-600">{t('consLossShared')}</p>
      )}
    </div>
    );
  };

  const card = (c: ConsignmentSummary) => {
    const r = remoteByRef.get(c.id);
    return (
      <div key={c.id} className="space-y-2 rounded-lg border p-3">
        <div className="flex items-center justify-between">
          <strong>{c.counterpartyName}</strong>
          <span className="text-xs text-muted-foreground">{c.status === 'closed' ? t('consClosed') : `${t('consWithMerchant')}: ${fmtTotal(c.open)}`}</span>
        </div>
        <div className="grid grid-cols-3 gap-2 text-sm">
          <div>{t('consSent')}<br /><b>{fmtTotal(c.sent)}</b></div>
          <div>{t('consSold')}<br /><b>{fmtTotal(c.sold)}</b></div>
          <div>{t('consReturned')}<br /><b>{fmtTotal(c.returned)}</b></div>
        </div>
        <div className="text-xs text-muted-foreground">{t('consBase')}: {fmtPrice(r?.basePriceQAR ?? unitCostOf(c.id))} · {t('consMyShare')}: {c.profitSharePct}</div>
        {renderEvents(r?.id || '')}
        {actions(c.id, false)}
        {draftForm(c.id)}
        {!r && c.sold === 0 && c.returned === 0 && (
          <Button size="sm" variant="ghost" onClick={() => undo(() => undoConsignmentTransfer(state, c.id))}>{t('consUndo')}</Button>
        )}
      </div>
    );
  };

  const incomingCard = (c: RemoteConsignment) => {
    const evs = eventsOf(c.id);
    const used = evs.filter(e => e.kind !== 'purchase' && e.kind !== 'settlement' && e.status !== 'rejected').reduce((s, e) => s + e.qty, 0);
    const held = Math.max(0, c.qty - used);
    const hasConfirmedSale = evs.some(e => e.kind === 'sale' && e.status === 'confirmed');
    return (
      <div key={c.id} className="space-y-2 rounded-lg border p-3">
        <div className="flex items-center justify-between">
          <strong>{c.counterpartyName}</strong>
          <span className="text-xs text-muted-foreground">{c.status === 'closed' ? t('consClosed') : `${t('consWithMerchant')}: ${fmtTotal(held)}`}</span>
        </div>
        <div className="text-xs text-muted-foreground">{t('consSent')}: {fmtTotal(c.qty)} · {t('consBase')}: {fmtPrice(c.basePriceQAR)} · {t('consMyShare')}: {100 - c.senderSharePct}</div>
        {renderEvents(c.id)}
        {c.status === 'open' && actions(c.id, false)}
        {c.status !== 'open' && hasConfirmedSale && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => startDraft(c.id, 'purchase')}>{t('consReportBuy')}</Button>
        )}
        {draftForm(c.id)}
      </div>
    );
  };

  const linked = merchants.find(m => m.relationshipId === form.merchant);

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold">{t('consTitle')}</h3>
        <p className="text-xs text-muted-foreground">{t('consHint')}</p>
      </div>

      <div className="flex flex-wrap items-end gap-2 rounded-lg border p-3">
        <select
          className="h-10 rounded-md border bg-background px-2 text-sm"
          value={form.merchant}
          onChange={e => setForm({ ...form, merchant: e.target.value })}
        >
          <option value="">{t('consPickMerchant')}</option>
          {merchants.map(m => <option key={m.relationshipId} value={m.relationshipId}>{m.name}</option>)}
        </select>
        {!linked && <Input className="w-40" placeholder={t('consMerchant')} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />}
        <Input className="w-32" inputMode="decimal" placeholder={t('consQty')} value={form.qty} onChange={e => setForm({ ...form, qty: e.target.value })} />
        <Input className="w-28" inputMode="decimal" placeholder={t('consMyShare')} value={form.share} onChange={e => setForm({ ...form, share: e.target.value })} />
        <Button disabled={busy} onClick={send}>{t('consSend')}</Button>
      </div>

      {local.length === 0 && incoming.length === 0 && <p className="text-sm text-muted-foreground">{t('consEmpty')}</p>}
      <div className="space-y-3">{local.map(card)}</div>

      {incoming.length > 0 && (
        <div className="space-y-3">
          <h4 className="font-medium">{t('consIncoming')}</h4>
          {incoming.map(incomingCard)}
        </div>
      )}

      {payables.length > 0 && (
        <div className="space-y-2">
          <h4 className="font-medium">{t('consPayable')}: {payables.map(r => `${r.counterpartyName} ${fmtTotal(r.owedQAR)}`).join(' · ')}</h4>
          <p className="text-xs text-muted-foreground">{t('consPayableHint')}</p>
        </div>
      )}

      {sales.length > 0 && (
        <div className="space-y-2">
          <h4 className="font-medium">{t('consOwed')}: {receivables.map(r => `${r.counterpartyName} ${fmtTotal(r.owedQAR)}`).join(' · ') || '—'}</h4>
          {sales.filter(s => consignmentSaleNetDue(s) > 0).map(s => {
            const due = consignmentSaleNetDue(s);
            const linked = s.consignment!.id ? remoteByRef.get(s.consignment!.id) : undefined;
            const saleEvent = linked ? eventsOf(linked.id).find(e => e.kind === 'sale' && e.id === s.id && e.status === 'confirmed') : undefined;
            const settle = async () => {
              setBusy(true);
              try {
                if (linked && saleEvent) {
                  await report.mutateAsync({
                    consignmentId: linked.id,
                    kind: 'settlement',
                    qty: s.amountUSDT,
                    amountQAR: due,
                    fundedFromSaleId: s.id,
                    clientRequestId: newId(),
                  });
                  toast.success(t('consSaved'));
                } else {
                  await undo(() => recordConsignmentSettlement(state, { saleId: s.id, amountQAR: due, settlementId: newId() }));
                }
              } catch (err) { fail(err); } finally { setBusy(false); }
            };
            return (
              <div key={s.id} className="flex items-center justify-between rounded-md border px-2 py-1 text-sm">
                <span>{s.exchangeCounterparty} · {fmtTotal(s.amountUSDT)} @ {fmtPrice(s.sellPriceQAR)} · {fmtTotal(due)}</span>
                <span className="flex gap-1">
                  <Button size="sm" variant="outline" disabled={busy} onClick={settle}>{t('consRemit')}</Button>
                  {!(s.consignment!.purchaseOffsetQAR || 0) && !s.consignment!.remittedQAR && (
                    <Button size="sm" variant="ghost" onClick={() => undo(() => undoConsignmentSale(state, s.id))}>{t('consUndo')}</Button>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
