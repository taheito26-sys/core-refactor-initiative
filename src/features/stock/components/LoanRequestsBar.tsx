import { useEffect, useRef } from 'react';
import { ArrowDownLeft, ArrowUpRight, Bell, Clock } from 'lucide-react';
import { toast } from 'sonner';
import { useT } from '@/lib/i18n';
import { fmtDate, fmtTotal, type TrackerState } from '@/lib/tracker-helpers';
import { useSharedLoanMoves } from '../hooks/useSharedLoanMoves';
import { useBorrowLendCommit } from '../hooks/useBorrowLendCommit';
import { bookApprovedLoanMove, revertDeclinedLoanMoves } from '../loan-sync';

/**
 * Loan movements shared with connected merchants: requests waiting for my
 * answer (approve books it on my side), my own requests waiting on them, and
 * the housekeeping that keeps both trackers in step — an approved request is
 * booked once, and a rejected or withdrawn one is taken back out.
 */
export function LoanRequestsBar({
  state,
  applyStateAndCommit,
}: {
  state: TrackerState;
  applyStateAndCommit: (next: TrackerState) => Promise<void>;
}) {
  const t = useT();
  const { moves, respond, cancel } = useSharedLoanMoves();
  const { commit } = useBorrowLendCommit(applyStateAndCommit);
  const working = useRef(false);

  useEffect(() => {
    if (working.current) return;
    let next = state;
    for (const m of moves) next = bookApprovedLoanMove(next, m).state;
    const reverted = revertDeclinedLoanMoves(next, moves);
    const changed = next !== state || reverted.state !== next;
    if (!changed) return;
    working.current = true;
    commit({ state: reverted.state, undismiss: reverted.undismiss, removeOrderLinks: reverted.removeOrderLinks }, 'mloanSynced')
      .catch((err) => console.error('[loan-sync] booking failed:', err))
      .finally(() => { working.current = false; });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moves, state]);

  const incoming = moves.filter((m) => !m.iAmProposer && m.status === 'pending');
  const waiting = moves.filter((m) => m.iAmProposer && m.status === 'pending');
  if (incoming.length === 0 && waiting.length === 0) return null;

  const answer = async (id: string, accept: boolean) => {
    try {
      await respond.mutateAsync({ id, accept });
      toast.success(t(accept ? 'loansApproved' : 'loansRejected'));
    } catch (err) {
      console.error('[loan-sync] answer failed:', err);
      toast.error(t('mloanSaveFailed'));
    }
  };

  const approveAll = async () => {
    let failed = 0;
    for (const m of incoming) {
      try { await respond.mutateAsync({ id: m.id, accept: true }); } catch { failed += 1; }
    }
    if (failed) toast.error(t('mloanSaveFailed')); else toast.success(t('loansApproved'));
  };

  const fill = (text: string, name: string, amount: number) => text.split('{name}').join(name).split('{amount}').join(fmtTotal(amount));

  return (
    <section className="ld-requests lg-reqs" aria-label={t('loansRequests')}>
      {incoming.length > 1 && (
        <button type="button" className="btn lg-req-all" disabled={respond.isPending} onClick={() => { void approveAll(); }}>
          {t('loansApproveAll').split('{n}').join(String(incoming.length))}
        </button>
      )}
      {incoming.map((m) => (
        <div key={m.id} className={`lg-req need ${m.direction === 'out' ? 'in' : 'out'}`}>
          <span className="lg-req-ic">{m.direction === 'out' ? <ArrowDownLeft /> : <ArrowUpRight />}</span>
          <div className="lg-req-body">
            <b className="lg-req-tag"><Bell /> {t('lgReqNeed')}</b>
            <strong>{fill(t(m.direction === 'out' ? 'loansReqSentYou' : 'loansReqYouSent'), m.counterpartyName, m.amountUSDT)}</strong>
            <small>{fmtDate(m.ts)} · {t('loansReqNote')}</small>
          </div>
          <div className="lg-req-btns">
            <button type="button" className="btn lg-req-ok" disabled={respond.isPending} onClick={() => { void answer(m.id, true); }}>{t('loansApprove')}</button>
            <button type="button" className="btn secondary" disabled={respond.isPending} onClick={() => { void answer(m.id, false); }}>{t('loansReject')}</button>
          </div>
        </div>
      ))}
      {waiting.map((m) => (
        <div key={m.id} className="lg-req wait">
          <span className="lg-req-ic"><Clock /></span>
          <div className="lg-req-body">
            <b className="lg-req-tag">{t('lgReqWait').split('{name}').join(m.counterpartyName)}</b>
            <strong>{fill(t('loansWaiting'), m.counterpartyName, m.amountUSDT)}</strong>
          </div>
          <div className="lg-req-btns">
            <button type="button" className="btn secondary" disabled={cancel.isPending} onClick={() => { void cancel.mutateAsync(m.id).catch(() => toast.error(t('mloanSaveFailed'))); }}>{t('loansWithdraw')}</button>
          </div>
        </div>
      ))}
    </section>
  );
}
