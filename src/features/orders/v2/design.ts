import { useCallback, useState } from 'react';

// ─── Which Orders layout is shown ───
// The redesigned phone layout ships next to the classic one. Anything the new layout cannot show stays reachable
// in it, and the classic layout is one tap (or ?orders=classic in the address) away, so going back never needs a
// release.

export type OrdersDesign = 'v2' | 'classic';

const KEY = 'orders-design';
export const DEFAULT_ORDERS_DESIGN: OrdersDesign = 'v2';

/** A page's chosen layout: `?<param>=classic` (or `=v2`) in the address wins and is remembered. */
export function readPageDesign(storageKey: string, param: string, search = typeof window !== 'undefined' ? window.location.search : ''): OrdersDesign {
  try {
    const forced = new URLSearchParams(search).get(param);
    if (forced === 'classic' || forced === 'v2') {
      localStorage.setItem(storageKey, forced);
      return forced;
    }
    const saved = localStorage.getItem(storageKey);
    return saved === 'classic' || saved === 'v2' ? saved : DEFAULT_ORDERS_DESIGN;
  } catch {
    return DEFAULT_ORDERS_DESIGN;
  }
}

export function usePageDesign(storageKey: string, param: string): [OrdersDesign, (next: OrdersDesign) => void] {
  const [design, setDesign] = useState<OrdersDesign>(() => readPageDesign(storageKey, param));
  const choose = useCallback((next: OrdersDesign) => {
    try { localStorage.setItem(storageKey, next); } catch { /* storage unavailable: the choice lasts for this visit */ }
    setDesign(next);
  }, [storageKey]);
  return [design, choose];
}

export const readOrdersDesign = (search?: string) => readPageDesign(KEY, 'orders', search);
export const useOrdersDesign = () => usePageDesign(KEY, 'orders');

/** The merchant home: the redesigned dashboard or the classic one, switched the same way (?home=classic). */
export const useHomeDesign = () => usePageDesign('home-design', 'home');

/** The Stock page: the redesigned phone layout or the classic one (?stock=classic). */
export const useStockDesign = () => usePageDesign('stock-design', 'stock');

/** Cash Management: the redesigned phone layout or the classic one (?cash=classic). */
export const useCashDesign = () => usePageDesign('cash-design', 'cash');
