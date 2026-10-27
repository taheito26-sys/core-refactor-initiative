import type { P2POffer } from './types';

export interface OfferFilters {
  search: string;
  method: string;
  amount: string;
  completion: string;
  online: boolean;
  sort: 'price' | 'available' | 'completion';
}

export const DEFAULT_OFFER_FILTERS: OfferFilters = {
  search: '', method: '', amount: '', completion: '', online: false, sort: 'price',
};

export function filterMarketOffers(offers: P2POffer[], side: 'buy' | 'sell', filters: OfferFilters): P2POffer[] {
  const amount = Number(filters.amount);
  const query = filters.search.trim().toLocaleLowerCase();
  return offers.filter(offer => {
    if (query && !offer.nick.toLocaleLowerCase().includes(query)) return false;
    if (filters.method && !offer.methods.includes(filters.method)) return false;
    if (filters.completion && offer.completion < Number(filters.completion)) return false;
    if (filters.online && offer.status?.toLowerCase() !== 'online') return false;
    if (Number.isFinite(amount) && amount > 0) {
      const fiat = amount * offer.price;
      if (offer.available < amount || fiat < offer.min || (offer.max > 0 && fiat > offer.max)) return false;
    }
    return true;
  }).sort((a, b) => {
    if (filters.sort === 'available') return b.available - a.available;
    if (filters.sort === 'completion') return b.completion - a.completion;
    return side === 'buy' ? a.price - b.price : b.price - a.price;
  });
}
