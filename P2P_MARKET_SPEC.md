# P2P Market - Full Product and Technical Specification

## 1. Purpose

This document captures the current P2P market behavior end-to-end so the Egypt implementation can be rebuilt, deployed, and audited without reverse-engineering the code again.

Scope covered:
- Supported market IDs and data model.
- Snapshot ingestion and read model.
- KPI math, including Egypt-specific logic.
- Merchant detail mapping.
- Deep scan behavior.
- Frontend component map.
- Known caveats and implementation checklist.

## 2. Supported Markets

Canonical market IDs used by the P2P feature:
- `qatar` (`QAR`)
- `uae` (`AED`)
- `egypt` (`EGP`)
- `ksa` (`SAR`)
- `turkey` (`TRY`)
- `oman` (`OMR`)
- `georgia` (`GEL`)
- `kazakhstan` (`KZT`)

The Egypt page is the only market currently surfaced in the P2P tracker UI. Qatar remains a read-only reference market for cross-market math.

## 3. Core Domain Types

### 3.1 `P2POffer`

Normalized offer shape used by UI and KPI logic.

```ts
{
  price: number;
  min: number;
  max: number;
  nick: string;
  methods: string[];
  available: number;
  trades: number;        // 30-day trades
  completion: number;    // 0..1 ratio
  feedback?: number;     // 0..1 ratio
  status?: string;
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

## 4. Read Model and Storage

### 4.1 Table: `public.p2p_snapshots`

Snapshot rows contain:
- `id`
- `market`
- `data` JSON payload
- `fetched_at`

The frontend reads from this table only. The current P2P UI does not compute market state from any other source.

### 4.2 Data freshness

- Qatar is used as the comparison market for Egypt KPI math.
- The frontend refreshes the latest snapshot, a 15-day price history window, and a 24h merchant window.
- Realtime inserts trigger a reload for the active market.

## 5. Snapshot Conversion Rules

### 5.1 Timestamp handling

- `ts` is normalized to epoch milliseconds.
- When `ts` is missing or drifts too far from `fetched_at`, the snapshot uses `fetched_at`.

### 5.2 Side correction

The converter is defensive about historical orientation drift.

If the raw payload appears swapped:
- `sellAvg` and `buyAvg` are flipped.
- `bestSell` and `bestBuy` are flipped.
- `sellDepth` and `buyDepth` are flipped.
- `sellOffers` and `buyOffers` are swapped and re-sorted.

### 5.3 Ratio normalization

`completion` and `feedback` are treated as ratios.
- Values in `0..1` are used directly.
- Values that look like percentages are normalized down.

## 6. Egypt KPI Logic

The Egypt UI shows exactly four FX-style KPI cards:
- `VCash V1`
- `VCash V2`
- `InstaPay V1`
- `InstaPay V2`

No spread KPI is shown in the Egypt flow.

### 6.1 Method classification

The feature classifies offers by payment methods already present in the snapshot payload.

VCash bucket:
- method matches `Vodafone Cash`, `VCash`, or `V-Cash` style names.

InstaPay / bank bucket:
- method matches `InstaPay` or bank-style methods.
- non-VCash offers are not used for the VCash bucket.

### 6.2 Distinct merchant rule

For Egypt KPI math, the denominator uses:
- top 20 distinct merchants
- deduped by merchant nickname first
- sorted by price
- only eligible merchants in the bucket are counted

### 6.3 Card formulas

Let:
- `QA Sell average` = Qatar `sellAvg`
- `QA Buy average` = Qatar `buyAvg`
- `EG Buy (top 20)` = average of the cheapest 20 distinct eligible Egypt buy offers

Then:
- `VCash V1 = QA Sell average / EG Buy (top 20)` for VCash merchants
- `VCash V2 = QA Buy average / EG Buy (top 20)` for VCash merchants
- `InstaPay V1 = QA Sell average / EG Buy (top 20)` for InstaPay/bank merchants
- `InstaPay V2 = QA Buy average / EG Buy (top 20)` for InstaPay/bank merchants

### 6.4 Egypt Average Buy override

The Egypt page exposes a manual override input for the average buy denominator.

Rules:
- only shown in the Egypt flow
- only affects `InstaPay V1`
- used only when valid: finite and greater than zero
- if invalid or empty, the computed Egypt buy average is used
- invalid values must never enter KPI math

## 7. Deep Scan Behavior

The deep scan is a client-side filter over current Egypt buy offers.

### 7.1 Required controls

Only these controls remain:
- `Required USDT`
- `Single Merchant Only`
- `Run Deep Scan`

No minimum 30-day trades filter.
No minimum completion filter.

### 7.2 Validation

Required USDT is valid only when it is:
- present
- finite
- greater than zero

Invalid input:
- does not run a scan
- shows validation
- does not show a misleading no-match state

### 7.3 Matching rules

A merchant matches when:
- `available >= required USDT`
- if `Single Merchant Only` is on, `max >= required USDT` also holds

The scan returns all matching merchants, not just one winner.

### 7.4 Display rules

Deep scan results are rendered as compact merchant cards.
Each result emphasizes:
- nickname
- price
- available
- max
- methods

Secondary details:
- 30d trades
- 30d completion
- feedback
- status
- avg pay
- avg release
- all-time trades
- trade type

The advertiser message is rendered in its own block and must preserve multiline Arabic text.

## 8. Merchant Info Data Pipeline

The merchant details are extracted from the snapshot payload and mapped into `P2POffer`.

The UI must show a field whenever the payload contains it. Honest fallback is allowed only when the payload truly lacks the field.

### 8.1 Mapped fields

#### 30d Trades
Source keys:
- `trades`
- `monthOrderCount`
- `monthlyOrderCount`
- `tradeCount30d`
- `orderCount30d`
- nested `advertiser.*`
- nested `adv.*`

#### 30d Completion
Source keys:
- `completion`
- `completionRate`
- `monthFinishRate`
- `monthlyFinishRate`
- `finishRate`
- nested `advertiser.*`
- nested `adv.*`

#### Feedback
Source keys:
- `feedback`
- `feedbackRate`
- `positiveRate`
- `positiveFeedbackRate`
- `feedbackScore`
- nested `advertiser.*`
- nested `adv.*`

#### Status
Source keys:
- `status`
- `onlineStatus`
- `userOnlineStatus`
- `merchantStatus`
- nested `advertiser.*`
- nested `adv.*`

#### Avg Pay
Source keys:
- `avgPay`
- `avgPayMinutes`
- `avgPayTime`
- `payTime`
- `avgPaymentTime`
- nested `advertiser.*`
- nested `adv.*`

#### Avg Release
Source keys:
- `avgRelease`
- `avgReleaseMinutes`
- `avgReleaseTime`
- `releaseTime`
- nested `advertiser.*`
- nested `adv.*`

#### All-time Trades
Source keys:
- `allTimeTrades`
- `allTrades`
- `tradeCount`
- `totalTrades`
- `totalOrderCount`
- nested `advertiser.*`
- nested `adv.*`

#### Trade Type
Source keys:
- `tradeType`
- `tradeTypeName`
- nested `advertiser.*`
- nested `adv.*`

#### Advertiser Message
Source keys:
- `message`
- `advertiserMessage`
- `advertiserInfo`
- `advertContent`
- `advertiserContent`
- `remark`
- `remarks`
- `autoReplyMsg`
- `additionalInfo`
- `advertiserTerms`
- nested `advertiser.*`
- nested `adv.*`

## 9. Frontend Components

### 9.1 `src/pages/P2PTrackerPage.tsx`

Current behavior:
- Egypt-only tracker page
- no market tabs
- refresh button only
- uses Egypt snapshot data, Qatar rates, history, merchant depth, offer tables, and deep scan results

### 9.2 `src/features/p2p/components/MarketKpiGrid.tsx`

Current behavior:
- Egypt-only KPI grid
- four cards only
- includes manual EGY Average Buy override input

### 9.3 `src/features/p2p/components/DeepScanResults.tsx`

Current behavior:
- validates Required USDT
- filters eligible merchants
- returns all matching merchants
- renders merchant cards side by side where space allows

### 9.4 `src/features/p2p/components/MerchantIntelligenceCard.tsx`

Current behavior:
- compact merchant details card
- shows the merchant metadata fields
- renders advertiser message with `whitespace-pre-wrap` and `dir="auto"`

### 9.5 `src/features/p2p/components/P2POfferTable.tsx`

Current behavior:
- shows live sell and buy offer rows
- preserves compact depth visualization
- shows extra merchant metadata when available

### 9.6 `src/features/p2p/hooks/useP2PMarketData.ts`

Current behavior:
- loads latest snapshot
- loads Qatar reference data when active market is not Qatar
- loads 15-day history
- loads 24h snapshots for merchant depth stats
- subscribes to realtime inserts on `p2p_snapshots`

### 9.7 `src/features/p2p/utils/converters.ts`

Current behavior:
- normalizes snapshots and offers
- supports fallback keys for old/new payload shapes
- computes distinct merchant averages for KPI math

## 10. Current File Map

Frontend source of truth:
- `src/pages/P2PTrackerPage.tsx`
- `src/features/p2p/types.ts`
- `src/features/p2p/hooks/useP2PMarketData.ts`
- `src/features/p2p/utils/converters.ts`
- `src/features/p2p/components/MarketKpiGrid.tsx`
- `src/features/p2p/components/DeepScanResults.tsx`
- `src/features/p2p/components/MerchantIntelligenceCard.tsx`
- `src/features/p2p/components/P2POfferTable.tsx`
- `src/features/p2p/components/PriceHistorySparklines.tsx`
- `src/features/p2p/components/MerchantDepthStats.tsx`
- `src/lib/i18n.ts`
- `src/App.tsx`

## 11. Known Caveats

- The Egypt method classification is regex-based and should be kept in sync with upstream payment-method labels.
- Deep scan is client-side and only sees the current snapshot payload.
- The tracker still depends on the database snapshot schedule and realtime inserts.
- If Qatar data is stale or absent, Egypt KPI cards cannot compute valid ratios.

## 12. Reimplementation Checklist

- [ ] Keep canonical market IDs unchanged.
- [ ] Keep Egypt as the only visible P2P market in the tracker page.
- [ ] Preserve the four Egypt KPI cards and remove spread from Egypt.
- [ ] Keep the EGY Average Buy override limited to InstaPay V1.
- [ ] Preserve deep scan validation and matching rules.
- [ ] Preserve merchant detail mapping and multiline Arabic rendering.
- [ ] Keep distinct-merchant averaging for denominator math.
- [ ] Keep realtime reloads for snapshot inserts.
- [ ] Keep history and merchant depth queries bounded.
- [ ] Keep the P2P implementation isolated from unrelated app pages.

This document should be updated whenever the P2P contract changes.
