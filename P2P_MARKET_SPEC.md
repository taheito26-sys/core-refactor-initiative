# P2P Market — Full Product & Technical Specification

## 1) Purpose

This document captures the current **P2P Market** behavior end-to-end so it can be implemented/refactored safely later without reverse-engineering the codebase again.

Scope covered:
- Supported markets and data model.
- Data ingestion (Binance API → Supabase snapshots).
- Aggregation/KPI logic.
- Frontend data loading and real-time refresh.
- UI modules (KPIs, history, merchant depth, offer tables, deep scan).
- Known caveats and implementation checklist for rebuild.

---

## 2) Supported Markets

Canonical market IDs (used across frontend + edge functions + DB records):

- `qatar` (QAR)
- `uae` (AED)
- `egypt` (EGP)
- `ksa` (SAR)
- `turkey` (TRY)
- `oman` (OMR)
- `georgia` (GEL)
- `kazakhstan` (KZT)

Pair labels follow `USDT/<FIAT>`.

---

## 3) Core Domain Types

### 3.1 `P2POffer`

Normalized offer shape used by UI/business logic:

```ts
{
  price: number;
  min: number;
  max: number;
  nick: string;
  methods: string[];
  available: number;
  trades: number;        // 30-day order count
  completion: number;    // ratio in 0..1
  feedback?: number;     // ratio in 0..1
  status?: string;       // Online/Offline/etc
  avgPay?: number;       // minutes
  avgRelease?: number;   // minutes
  allTimeTrades?: number;
  tradeType?: string;
  message?: string;
}
```

### 3.2 `P2PSnapshot`

```ts
{
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
```

### 3.3 `P2PHistoryPoint`

```ts
{
  ts: number;
  sellAvg: number | null;
  buyAvg: number | null;
  spread: number | null;
  spreadPct: number | null;
}
```

---

## 4) Data Storage (Supabase)

## 4.1 Table: `public.p2p_snapshots`

- `id UUID PK`
- `market TEXT NOT NULL`
- `data JSONB NOT NULL` (snapshot payload)
- `fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()`

Indexes / replication:
- `idx_p2p_snapshots_market_time (market, fetched_at DESC)` for latest/history reads.
- `REPLICA IDENTITY FULL` is enabled so realtime filters like `market=eq.qatar` work reliably.
- Table is added to `supabase_realtime` publication.

RLS:
- Authenticated users can read snapshots.
- Inserts are done by edge functions via service role key.

---

## 5) Ingestion Pipeline

## 5.1 Function: `supabase/functions/p2p-scraper`

Input:
- Optional query param `market=<marketId>`.
- If absent, all markets are scraped.

Source API:
- Binance endpoint: `POST /bapi/c2c/v2/friendly/c2c/adv/search`.
- Two calls per market:
  - `tradeType=SELL`
  - `tradeType=BUY`
- `rows=20` each side.

Normalization/parsing:
- Extracts adv + advertiser fields into `P2POffer`-like structure.
- Payment methods mapped from `tradeMethods[].tradeMethodName` fallback to identifier.
- Completion/feedback kept as numeric values from Binance (later normalized client-side if needed).

Critical orientation logic:
- `sellOffers` are built from Binance `BUY` ads (descending price).
- `buyOffers` are built from Binance `SELL` ads (ascending price).

This reflects business semantics:
- **Sell offers** = what market will pay us when we sell USDT (best is highest).
- **Buy offers** = cheapest restock side when we buy USDT (best is lowest).

Snapshot metrics in function:
- `sellAvg`: average of top 10 sell offers.
- `buyAvg`: average of top 10 buy offers.
- `bestSell`: first sell offer price (highest).
- `bestBuy`: first buy offer price (lowest).
- `spread = sellAvg - buyAvg`.
- `spreadPct = spread / buyAvg * 100`.
- `sellDepth`: sum of sell offer `available`.
- `buyDepth`: sum of buy offer `available`.

Output:
- Inserts one row into `p2p_snapshots` per market.
- Returns summary JSON per market.

## 5.2 Function: `supabase/functions/p2p-cron`

- Runs every 5 minutes (`*/5 * * * *`).
- Calls `p2p-scraper` sequentially for each canonical market.
- Aggregates per-market status.
- `verify_jwt=false` in config for scheduler usage.

---

## 6) Frontend Read Model & Refresh Behavior

## 6.1 Hook: `useP2PMarketData(market)`

Load sequence:
1. Fetch latest snapshot row for selected market.
2. If market != qatar, also fetch latest qatar snapshot for cross-rate math.
3. Fetch up to 15 days of history (`<= 10000` rows).
4. Fetch last 24h snapshots (`<= 2500`) to compute merchant depth stats.

Realtime:
- Subscribes to `postgres_changes` INSERT on `p2p_snapshots` with filter `market=eq.<market>`.
- Triggers full reload on each new row.

Error behavior:
- Exposes an `error` state and logs issues.
- If no latest row exists, uses an empty snapshot state.

## 6.2 Converter safeguards

`toSnapshot` / `toOffer` add resilience:
- Timestamp normalization and drift correction against `fetched_at`.
- Auto-detect swapped avg orientation (`sellAvg < buyAvg`) and flip fields + offers.
- Completion and feedback normalization to 0..1 when source sends percent-style values.
- Fallback key handling for historical shape differences.

---

## 7) UI Modules (P2P Tracker Page)

Route:
- Canonical page: `/trading/p2p`
- Redirect alias: `/p2p` → `/trading/p2p`

Primary blocks:

1. **Market Tabs + Refresh**
   - Switches market context and clears deep-scan result cache.
   - Manual refresh button calls `refresh()`.
   - Status hint indicates 5-min sync cadence.

2. **KPI Grid (`MarketKpiGrid`)**
   - Best Sell, Sell Avg (top 5 label for Qatar, top 10 for others), Best Restock.
   - Today high sell / today low buy based on same-day history points.
   - Non-Egypt only: “Profit if sold now” and “Round-trip spread” simulations using tracker inventory state.
   - Egypt only: special cross-market VCASH/INSTAPAY cards.

3. **Price History Sparklines**
   - Last 24h trend from history points.
   - 12 bars each for sell and buy series (downsampled).
   - Shows latest value and absolute delta vs first point in 24h window.

4. **Merchant Depth Stats**
   - Built from all offers across last 24h snapshots.
   - Top 5 by appearance frequency (availability ratio).
   - Top 5 by max available quantity with avg quantity preview.

5. **Offer Tables**
   - Sell offers (highest first).
   - Restock/buy offers (cheapest first).
   - Rows show trader, price, min/max, methods, and a mini depth bar.

6. **Deep Market Scan**
   - Input: required USDT amount.
   - Optional `singleMerchantOnly` (must satisfy full amount in one transaction based on `max / price`).
   - Filters buy/restock offers by stock sufficiency and optional single-merchant constraint.
   - Results sorted by best price (ascending).
   - Shows quality stats (30d trades, completion, feedback, avg pay/release, all-time, type) and message.

---

## 8) Egypt Cross-Rate KPI Logic (Special Case)

Active only when selected market is `egypt` and latest `qatar` rates are available.

Inputs:
- Egypt buy offers.
- Qatar `sellAvg` and `buyAvg`.

Classification:
- VCash regex for Vodafone-like methods.
- InstaPay/bank regex for bank + non-VCash wallet methods.
- Safety fallback: non-VCash methods if explicit Insta regex yields none.

Method:
- Deduplicate by merchant nick.
- Take cheapest 20 distinct offers for each bucket.
- Compute average buy price per bucket.

KPI outputs:
- `vCashV1 = egBuyVCashAvg / qaSellAvg`
- `vCashV2 = egBuyVCashAvg / qaBuyAvg`
- `instaPayV1 = egBuyInstaAvg / qaSellAvg`
- `instaPayV2 = egBuyInstaAvg / qaBuyAvg`

Displayed as EGP-per-QAR style conversion cards.

---

## 9) Freshness, Latency, and “Live” Semantics

Current expectations:
- Backend sync scheduled every 5 minutes.
- Frontend realtime subscription reacts as soon as insert event arrives.
- Dashboard `useP2PRates` marks data `isLive` when latest row age < 5 min.

Operational implication:
- If cron misses runs or scraper fails, UI continues showing stale latest snapshot until next successful insert.

---

## 10) Known Risks / Edge Cases

1. **No-data bootstrapping**
   - Page shows waiting state until first snapshot exists for market.

2. **Orientation mismatch risk**
   - Ingestion and display semantics are intentionally inverted from Binance tradeType naming.
   - Converter has swap fallback, but ingestion contract should remain explicit.

3. **Regex fragility for Egypt methods**
   - Payment method names can evolve; fallback reduces but does not eliminate drift.

4. **Potential load cost**
   - 15-day / 10k row history + 24h / 2.5k row merchant scan is acceptable now but should be monitored as row volume scales.

5. **Manual deep scan is client-side only**
   - Works off current snapshot, not full live orderbook depth.

---

## 11) Reimplementation Checklist (for future work)

When reimplementing, preserve these invariants:

- [ ] Keep canonical market IDs unchanged.
- [ ] Preserve sell/buy semantic orientation used by business logic.
- [ ] Compute averages from top 10 offers (current contract).
- [ ] Persist raw-ish snapshot JSON for backward compatibility.
- [ ] Ensure realtime filtering works (`REPLICA IDENTITY FULL` + publication membership).
- [ ] Keep converter safety for timestamp drift + swapped-side correction.
- [ ] Preserve Egypt VCASH/INSTAPAY logic and fallback behavior.
- [ ] Keep deep scan constraints (available amount + optional single-merchant max).
- [ ] Keep 5-minute scheduler behavior unless intentionally changed across frontend and backend.

---

## 12) File Map (Source of Truth)

Backend:
- `supabase/functions/p2p-scraper/index.ts`
- `supabase/functions/p2p-cron/index.ts`
- `supabase/config.toml`
- `supabase/migrations/20260322061444_63358a0f-0a2e-4a40-ae46-dadcbe0e5b2f.sql`
- `supabase/migrations/20260325010000_p2p_snapshots_replica_identity.sql`

Frontend:
- `src/pages/P2PTrackerPage.tsx`
- `src/features/p2p/types.ts`
- `src/features/p2p/hooks/useP2PMarketData.ts`
- `src/features/p2p/utils/converters.ts`
- `src/features/p2p/components/MarketKpiGrid.tsx`
- `src/features/p2p/components/PriceHistorySparklines.tsx`
- `src/features/p2p/components/MerchantDepthStats.tsx`
- `src/features/p2p/components/P2POfferTable.tsx`
- `src/features/p2p/components/DeepScanResults.tsx`
- `src/features/dashboard/hooks/useP2PRates.ts`
- `src/App.tsx`

This document is intended to be updated whenever any of the above contracts change.
