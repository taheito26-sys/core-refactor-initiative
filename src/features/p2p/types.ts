export type MarketId = 'qatar' | 'uae' | 'egypt' | 'ksa' | 'turkey' | 'oman' | 'georgia' | 'kazakhstan' | 'egypt_fx_qar' | 'egypt_vcash' | 'egypt_bank';

/** Markets whose snapshot data is derived from the 'egypt' base market rather than scraped independently. */
export const DERIVED_EGYPT_MARKETS: MarketId[] = ['egypt_fx_qar', 'egypt_vcash', 'egypt_bank'];

/** The base market id used to derive the Egypt variant markets. */
export function baseMarketId(market: MarketId): MarketId {
  if (DERIVED_EGYPT_MARKETS.includes(market)) return 'egypt';
  return market;
}

export interface MarketConfig {
  id: MarketId;
  label: string;
  currency: string;
  pair: string;
}

export type PaymentMethodCategory =
  | 'vodafone_cash'
  | 'instapay'
  | 'bank'
  | 'wallet'
  | 'other';

export interface P2POffer {
  price: number;
  min: number;
  max: number;
  nick: string;
  methods: string[];
  available: number;
  trades: number;
  completion: number;
  merchant30dTrades?: number | null;
  merchant30dCompletion?: number | null;
  advertiserMessage?: string | null;
  feedbackCount?: number | null;
  avgReleaseMinutes?: number | null;
  avgPayMinutes?: number | null;
  allTrades?: number | null;
  tradeType?: string | null;
  onlineStatus?: 'online' | 'offline' | 'unknown' | null;
  paymentMethodCategories?: PaymentMethodCategory[];
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
}

export interface P2PHistoryPoint {
  ts: number;
  sellAvg: number | null;
  buyAvg: number | null;
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
  merchant30dTrades?: number | null;
  merchant30dCompletion?: number | null;
  advertiserMessage?: string | null;
  feedbackCount?: number | null;
  avgReleaseMinutes?: number | null;
  avgPayMinutes?: number | null;
  allTrades?: number | null;
  tradeType?: string | null;
  onlineStatus?: 'online' | 'offline' | 'unknown' | null;
  paymentMethodCategories?: PaymentMethodCategory[];
}

export const MARKETS: MarketConfig[] = [
  { id: 'qatar', label: 'Qatar', currency: 'QAR', pair: 'USDT/QAR' },
  { id: 'uae', label: 'UAE', currency: 'AED', pair: 'USDT/AED' },
  { id: 'egypt', label: 'Egypt', currency: 'EGP', pair: 'USDT/EGP' },
  { id: 'egypt_fx_qar', label: 'EGP→QAR FX', currency: 'EGP', pair: 'EGP/QAR' },
  { id: 'egypt_vcash', label: 'EGP V2 VCash', currency: 'EGP', pair: 'USDT/EGP' },
  { id: 'egypt_bank', label: 'EGP V2 Bank', currency: 'EGP', pair: 'USDT/EGP' },
  { id: 'ksa', label: 'KSA', currency: 'SAR', pair: 'USDT/SAR' },
  { id: 'turkey', label: 'Turkey', currency: 'TRY', pair: 'USDT/TRY' },
  { id: 'oman', label: 'Oman', currency: 'OMR', pair: 'USDT/OMR' },
  { id: 'georgia', label: 'Georgia', currency: 'GEL', pair: 'USDT/GEL' },
  { id: 'kazakhstan', label: 'Kazakhstan', currency: 'KZT', pair: 'USDT/KZT' },
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
};
