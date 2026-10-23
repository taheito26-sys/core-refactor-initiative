import { useCallback, useState } from 'react';

// ─── Which layout the app is shown in ───
// The redesigned phone layout ships next to the classic one. One switch, at the top of the home page, picks it for
// every page (home, Orders, Stock, Cash Management), so going back never needs a release. `?home=classic` in the
// address does the same; the older per-page `?orders=`, `?stock=` and `?cash=` still work and set the same choice.

export type OrdersDesign = 'v2' | 'classic';

const KEY = 'home-design';
const PARAMS = ['home', 'orders', 'stock', 'cash'];
export const DEFAULT_ORDERS_DESIGN: OrdersDesign = 'v2';

/** The app's chosen layout: a `?home=classic` (or `=v2`) in the address wins and is remembered. */
export function readPageDesign(storageKey: string, params: string | string[], search = typeof window !== 'undefined' ? window.location.search : ''): OrdersDesign {
  try {
    const query = new URLSearchParams(search);
    for (const param of Array.isArray(params) ? params : [params]) {
      const forced = query.get(param);
      if (forced === 'classic' || forced === 'v2') {
        localStorage.setItem(storageKey, forced);
        return forced;
      }
    }
    const saved = localStorage.getItem(storageKey);
    return saved === 'classic' || saved === 'v2' ? saved : DEFAULT_ORDERS_DESIGN;
  } catch {
    return DEFAULT_ORDERS_DESIGN;
  }
}

export function usePageDesign(storageKey: string, params: string | string[]): [OrdersDesign, (next: OrdersDesign) => void] {
  const [design, setDesign] = useState<OrdersDesign>(() => readPageDesign(storageKey, params));
  const choose = useCallback((next: OrdersDesign) => {
    try { localStorage.setItem(storageKey, next); } catch { /* storage unavailable: the choice lasts for this visit */ }
    setDesign(next);
  }, [storageKey]);
  return [design, choose];
}

export const readAppDesign = (search?: string) => readPageDesign(KEY, PARAMS, search);
export const useAppDesign = () => usePageDesign(KEY, PARAMS);

export const readOrdersDesign = readAppDesign;
export const useHomeDesign = useAppDesign;
export const useOrdersDesign = useAppDesign;
export const useStockDesign = useAppDesign;
export const useCashDesign = useAppDesign;
