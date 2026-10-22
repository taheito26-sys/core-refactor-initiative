import { useCallback, useState } from 'react';

// ─── Which Orders layout is shown ───
// The redesigned phone layout ships next to the classic one. Anything the new layout cannot show stays reachable
// in it, and the classic layout is one tap (or ?orders=classic in the address) away, so going back never needs a
// release.

export type OrdersDesign = 'v2' | 'classic';

const KEY = 'orders-design';
export const DEFAULT_ORDERS_DESIGN: OrdersDesign = 'v2';

export function readOrdersDesign(search = typeof window !== 'undefined' ? window.location.search : ''): OrdersDesign {
  try {
    const forced = new URLSearchParams(search).get('orders');
    if (forced === 'classic' || forced === 'v2') {
      localStorage.setItem(KEY, forced);
      return forced;
    }
    const saved = localStorage.getItem(KEY);
    return saved === 'classic' || saved === 'v2' ? saved : DEFAULT_ORDERS_DESIGN;
  } catch {
    return DEFAULT_ORDERS_DESIGN;
  }
}

export function useOrdersDesign(): [OrdersDesign, (next: OrdersDesign) => void] {
  const [design, setDesign] = useState<OrdersDesign>(() => readOrdersDesign());
  const choose = useCallback((next: OrdersDesign) => {
    try { localStorage.setItem(KEY, next); } catch { /* storage unavailable: the choice lasts for this visit */ }
    setDesign(next);
  }, []);
  return [design, choose];
}
