# P2P Market Tracker — Product Requirements Document

## Original Problem Statement
Implement the P2P_MARKET_SPEC.md: 8 canonical P2P markets (Qatar, UAE, Egypt, KSA, Turkey, Oman, Georgia, Kazakhstan), Supabase scraper/cron with top-20 averages (Qatar top-5), extended offer fields, UI components (Market KPI grid, Price sparklines, Merchant Depth, Deep scan), and fix deployment/merge issues.

## Tech Stack
- **Frontend**: React + Vite + Tailwind CSS + Shadcn/UI + Zustand
- **Auth**: Supabase Auth (Google OAuth + email/password) with dev mode bypass
- **Backend**: Supabase Edge Functions (Deno) for p2p-scraper and p2p-cron
- **Database**: Supabase (PostgreSQL) — p2p_market_data table
- **Deployment**: Vercel (root vercel.json redirects to frontend/)
- **PWA**: vite-plugin-pwa with service worker

## What's Been Implemented

### P2P Markets (DONE)
- 8 canonical markets: Qatar, UAE, Egypt, KSA, Turkey, Oman, Georgia, Kazakhstan
- Market types, hooks (useP2PMarketData), converters in `/frontend/src/features/p2p/`

### P2P UI Components (DONE)
- MarketKpiGrid — 6 KPI cards (Best Sell, Sell Avg Top-5, Best Restock, Spread, Today High/Low)
- PriceHistorySparklines — 24h line charts for sell/buy averages
- MerchantDepthStats — Top by frequency/volume
- P2POfferTable — Sell & Restock dual tables
- DeepScanResults — USDT amount scanner
- Historical Averages — Collapsible 7D/15D table

### Supabase Edge Functions (DONE)
- p2p-scraper: Updated for all 8 markets, rows=20, Qatar top-5 avg
- p2p-cron: Schedules scraping across markets

### Git Merge Resolution (DONE)
- Resolved 205 structural conflicts (src/ vs frontend/src/)
- Kept frontend/src/ architecture
- Stubbed missing imports from main branch

### Vercel Config (DONE)
- Root /vercel.json forces `cd frontend && npm install && npm run build`

### Bug Fixes (DONE)
- Fixed __APP_BUILD_ID__ missing from vite.config.ts define block
- Cleared stale Vite dep cache causing 403s in dev mode

## Stubbed Features (from main branch merge)
- `features/chat/components/ChatRuntimeBootstrap.tsx` — returns null
- `features/chat/pages/ChatWorkspacePage.tsx` — returns null
- `services/ledgerImport/parser.ts` — returns empty array
- `platform/native-bridge.tsx` — returns null

## Pending
- Push to GitHub via "Save to Github" (user action)
- Verify Vercel deployment after push
- Replace stubs with real implementations if needed
- Code-splitting optimization (main bundle ~1.9MB)

## Key Files
- `/app/vercel.json` — DO NOT DELETE
- `/app/frontend/vite.config.ts` — includes __APP_BUILD_ID__ define
- `/app/frontend/src/pages/P2PTrackerPage.tsx`
- `/app/frontend/src/features/p2p/` — types, hooks, components
- `/app/frontend/supabase/functions/p2p-scraper/index.ts`
