import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useExchangeP2POrders } from '../hooks/useExchangeP2POrders';
import { useExchangeOrderLinks, sumLinkedAmount } from '../hooks/useExchangeOrderLinks';

const AMOUNT_EPSILON = 0.01;

/**
 * Always-on flag for P2P orders the exchange reports but the tracker doesn't
 * fully account for yet -- whole orders never imported, and orders only
 * partially registered (the rest still owed to another customer/supplier).
 * Self-contained (fetches its own data) so it can drop into any page without
 * threading props through -- unlike ExchangeInbox, which only shows up once
 * the sale/batch form is open.
 */
export function UnregisteredOrdersBanner({ side }: { side?: 'buy' | 'sell' }) {
  const { data: orders } = useExchangeP2POrders();
  const { data: linksByOrder } = useExchangeOrderLinks();

  if (!orders || orders.length === 0) return null;

  const relevant = side ? orders.filter((o) => o.side === side) : orders;
  const flagged = relevant
    .map((o) => {
      const linkedAmount = sumLinkedAmount(linksByOrder?.get(o.id));
      const remaining = Math.max(0, o.amount - linkedAmount);
      return { order: o, linkedAmount, remaining };
    })
    .filter((r) => r.remaining > AMOUNT_EPSILON);

  if (flagged.length === 0) return null;

  const fullyUnregistered = flagged.filter((r) => r.linkedAmount <= AMOUNT_EPSILON).length;
  const partiallyRegistered = flagged.length - fullyUnregistered;

  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400',
      )}
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <div>
        <span className="font-semibold">
          {flagged.length} exchange {flagged.length === 1 ? 'order' : 'orders'} not fully registered in the tracker
        </span>
        {' — '}
        {fullyUnregistered > 0 && `${fullyUnregistered} not registered at all`}
        {fullyUnregistered > 0 && partiallyRegistered > 0 && ', '}
        {partiallyRegistered > 0 && `${partiallyRegistered} only partially registered`}
        . Open "From your exchanges" below to import the rest.
      </div>
    </div>
  );
}
