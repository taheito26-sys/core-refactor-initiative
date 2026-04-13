// P2P Market — Canonical Domain Types
// Source of truth aligned with P2P Market Spec

export type MarketId =
  | 'qatar'
  | 'uae'
  | 'egypt'
  | 'ksa'
  | 'turkey'
  | 'oman'
  | 'georgia'
  | 'kazakhstan';

export interface P2POffer {
  price: number;
  min: number;
  max: number;
  nick: string;
  methods: string[];
  available: number;
  trades: number;         // 30-day order count
  completion: number;     // ratio 0..1
  feedback?: number;      // ratio 0..1
  status?: string;        // user / merchant / pro-merchant / etc
  avgPay?: number;        // avg payment time in minutes
  avgRelease?: number;    // avg release time in minutes
  allTimeTrades?: number; // all-time trade count
  tradeType?: string;     // Binance original tradeType (BUY/SELL)
  message?: string;       // advertiser remarks
}

export interface P2PSnapshot {
  ts: number;              // epoch ms
  sellAvg: number | null;
  buyAvg: number | null;
  bestSell: number | null;
  bestBuy: number | null;
  spread: number | null;
  spreadPct: number | null;
  sellDepth: number;
  buyDepth: number;
  sellOffers: P2POffer[];
  buyOffers: P2POffer[];
}

export interface P2PHistoryPoint {
  ts: number;
  sellAvg: number | null;
  buyAvg: number | null;
  spread: number | null;
  spreadPct: number | null;
}

export interface MarketConfig {
  id: MarketId;
  label: string;
  currency: string;
  pair: string;
}

export const MARKETS: MarketConfig[] = [
  { id: 'qatar',      label: 'Qatar',      currency: 'QAR', pair: 'USDT/QAR' },
  { id: 'uae',        label: 'UAE',        currency: 'AED', pair: 'USDT/AED' },
  { id: 'egypt',      label: 'Egypt',      currency: 'EGP', pair: 'USDT/EGP' },
  { id: 'ksa',        label: 'KSA',        currency: 'SAR', pair: 'USDT/SAR' },
  { id: 'turkey',     label: 'Turkey',     currency: 'TRY', pair: 'USDT/TRY' },
  { id: 'oman',       label: 'Oman',       currency: 'OMR', pair: 'USDT/OMR' },
  { id: 'georgia',    label: 'Georgia',    currency: 'GEL', pair: 'USDT/GEL' },
  { id: 'kazakhstan', label: 'Kazakhstan', currency: 'KZT', pair: 'USDT/KZT' },
];

export const EMPTY_SNAPSHOT: P2PSnapshot = {
  ts: 0,
  sellAvg: null,
  buyAvg: null,
  bestSell: null,
  bestBuy: null,
  spread: null,
  spreadPct: null,
  sellDepth: 0,
  buyDepth: 0,
  sellOffers: [],
  buyOffers: [],
};

// Avg computation bucket per market: qatar=5, others=20
export const MARKET_AVG_TOP: Record<MarketId, number> = {
  qatar:      5,
  uae:        20,
  egypt:      20,
  ksa:        20,
  turkey:     20,
  oman:       20,
  georgia:    20,
  kazakhstan: 20,
};
