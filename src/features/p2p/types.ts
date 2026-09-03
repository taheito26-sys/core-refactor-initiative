export type MarketId = 'qatar' | 'egypt';

export interface MarketConfig {
  id: MarketId;
  label: string;
  currency: string;
  pair: string;
}

export interface P2POffer {
  price: number;
  min: number;
  max: number;
  nick: string;
  methods: string[];
  available: number;
  trades: number;
  completion: number;
  feedback?: number;
  status?: string;
  avgPay?: number;
  avgRelease?: number;
  allTimeTrades?: number;
  tradeType?: string;
  message?: string;
}

export interface P2PSnapshot {
  ts: number;
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
  banqueMisrSellOffers?: P2POffer[];
}

export interface P2PHistoryPoint {
  ts: number;
  sellAvg: number | null;
  buyAvg: number | null;
  bestSell?: number | null;
  bestBuy?: number | null;
  spread: number | null;
  spreadPct: number | null;
}

export interface DaySummary {
  date: string;
  highSell: number;
  lowSell: number | null;
  highBuy: number;
  lowBuy: number | null;
  polls: number;
}

export interface MerchantStat {
  nick: string;
  appearances: number;
  availabilityRatio: number;
  avgAvailable: number;
  maxAvailable: number;
}

export const MARKETS: MarketConfig[] = [
  { id: 'qatar', label: 'Qatar', currency: 'QAR', pair: 'USDT/QAR' },
  { id: 'egypt', label: 'Egypt', currency: 'EGP', pair: 'USDT/EGP' },
];

export const EMPTY_SNAPSHOT: P2PSnapshot = {
  ts: Date.now(),
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
  banqueMisrSellOffers: [],
};
