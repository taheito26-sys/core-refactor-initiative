import { create } from 'zustand';
import type { OrderScope } from './dashboard-model';

// The dashboard home's own filters. They sit in a store because the buttons that open the filter and
// search sheets live in the top bar, while the sheets and the figures they change live on the page.
interface DashboardFilters {
  /** Which orders the figures count: all of them, the merchant's own, or deals with partners. */
  scope: OrderScope;
  /** A custom period (YYYY-MM-DD each); when both are set it replaces the range chosen in the top bar. */
  customFrom: string;
  customTo: string;
  filterOpen: boolean;
  searchOpen: boolean;
  setScope: (scope: OrderScope) => void;
  setCustom: (from: string, to: string) => void;
  reset: () => void;
  setFilterOpen: (open: boolean) => void;
  setSearchOpen: (open: boolean) => void;
}

export const useDashboardFilters = create<DashboardFilters>(set => ({
  scope: 'all',
  customFrom: '',
  customTo: '',
  filterOpen: false,
  searchOpen: false,
  setScope: scope => set({ scope }),
  setCustom: (customFrom, customTo) => set({ customFrom, customTo }),
  reset: () => set({ scope: 'all', customFrom: '', customTo: '' }),
  setFilterOpen: filterOpen => set({ filterOpen }),
  setSearchOpen: searchOpen => set({ searchOpen }),
}));
