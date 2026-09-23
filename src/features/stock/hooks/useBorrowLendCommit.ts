import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useT, type TranslationKey } from '@/lib/i18n';
import type { TrackerState } from '@/lib/tracker-helpers';
import { addOrderLink, dismissTransfer, removeOrderLink, undismissTransfer } from '@/features/exchanges/api';
import type { TagResult } from '../usdt-tagging';

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
      toast.error(t('mloanSaveFailed'));
      return false;
    } finally {
      setBusy(false);
    }
  }, [applyStateAndCommit, queryClient, t]);

  return { commit, busy };
}
