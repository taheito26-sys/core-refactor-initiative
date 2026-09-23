import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useT, type TranslationKey } from '@/lib/i18n';
import type { TrackerState } from '@/lib/tracker-helpers';
import { addOrderLink, dismissTransfer, removeOrderLink, undismissTransfer } from '@/features/exchanges/api';
import type { ExchangeP2POrder, ExchangeTransfer } from '@/features/exchanges/types';
import type { UsdtTransferKind } from '@/lib/usdt-transfers';
import { uid } from '@/lib/tracker-helpers';
import { tagExchangeOrder, tagExchangeTransfer, TagError, type TagResult } from '../usdt-tagging';

/** A borrow/lend tag made straight from an exchange-inbox row. */
export type InboxLoanTagRequest =
  | { source: 'transfer'; transfer: ExchangeTransfer; kind: UsdtTransferKind; name: string }
  | { source: 'order'; order: ExchangeP2POrder; available: number; amount: number; kind: UsdtTransferKind; name: string };

/**
 * Saves a borrow/lend tag: commits the tracker state first (so "done" means
 * durable), then applies its exchange-side bookkeeping — inbox dismissals
 * and P2P order split links — and refreshes the exchange queries so every
 * inbox and the Borrow / Lend tab agree on what is left to import.
 */
export function useBorrowLendCommit(applyStateAndCommit: (next: TrackerState) => Promise<void>) {
  const t = useT();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  const commit = useCallback(async (result: TagResult, okMsg: TranslationKey): Promise<boolean> => {
    setBusy(true);
    try {
      await applyStateAndCommit(result.state);
      const ops = [
        ...(result.dismiss || []).map(id => dismissTransfer(id)),
        ...(result.undismiss || []).map(id => undismissTransfer(id)),
        ...(result.orderLinks || []).map(l => addOrderLink(l.orderId, l.entityType, l.entityId, l.amount, l.label)),
        ...(result.removeOrderLinks || []).map(l => removeOrderLink(l.orderId, l.entityId)),
      ];
      if (ops.length) {
        const settled = await Promise.allSettled(ops);
        for (const r of settled) if (r.status === 'rejected') console.error('[borrow-lend] exchange link update failed:', r.reason);
        void queryClient.invalidateQueries({ queryKey: ['exchange-transfers'] });
        void queryClient.invalidateQueries({ queryKey: ['exchange-p2p-orders'] });
        void queryClient.invalidateQueries({ queryKey: ['exchange-p2p-order-links'] });
      }
      toast.success(t(okMsg));
      return true;
    } catch (err) {
      console.error('[borrow-lend] save failed:', err);
      toast.error(t('uxferSaveFailed'));
      return false;
    } finally {
      setBusy(false);
    }
  }, [applyStateAndCommit, queryClient, t]);

  /** Tag an exchange-inbox row (a Pay/on-chain transfer or a P2P order) from the page's current state. */
  const tagFromInbox = useCallback(async (state: TrackerState, req: InboxLoanTagRequest): Promise<boolean> => {
    if (!req.name.trim()) {
      toast.error(t('uxferErrName'));
      return false;
    }
    let result: TagResult;
    try {
      result = req.source === 'transfer'
        ? tagExchangeTransfer(state, req.transfer, req.kind, req.name, uid())
        : tagExchangeOrder(state, req.order, req.kind, req.name, uid(), req.available, req.amount);
    } catch (err) {
      const bad = err instanceof TagError && err.code === 'bad_amount';
      toast.error(bad && req.source === 'order' ? `${t('uxferErrPart')} ${req.available}` : t('uxferSaveFailed'));
      return false;
    }
    return commit(result, 'uxferRecorded');
  }, [commit, t]);

  return { commit, tagFromInbox, busy };
}
