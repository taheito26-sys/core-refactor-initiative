# CLAUDE.md

Guidance for AI assistants working in this repository. Read this before making changes.

## 0. Git workflow — commit and push to `main`

**Standing instruction from the repo owner: commit and push directly to `main`.**

- Do not park finished work on a feature branch waiting for a merge — the owner
  runs the app off `main`, and anything not on `main` is invisible to them.
- If a session is started on a designated feature branch, still land the work on
  `main` when it's done: merge the branch (or commit straight to `main`) and push.
- Run the checks before pushing: `npx tsc -p tsconfig.app.json --noEmit`,
  `npx eslint <changed files>`, and `npx vitest run`. The repo has pre-existing
  failures in unrelated suites — compare against a clean-tree baseline rather
  than expecting zero, and never push a change that adds new ones.
- A pull request is optional here, not the delivery mechanism. Open one only when
  the owner asks for a review; otherwise merging it immediately is expected.

## 1. What this project is

**The Tracker** (`core-refactor-initiative`) — a single Vite + React + TypeScript codebase that
ships to three surfaces from one build:

- desktop web (Vercel)
- mobile web / installable PWA (`vite-plugin-pwa`)
- native Android + iOS shells (Capacitor, `appId: com.taheito26sys.corerefactorinitiative`)

Domain: P2P / OTC currency trading between **merchants** and their **customers**, primarily the
QAR ⇄ EGP corridor with USDT as the settlement asset. The app covers order intake and approval,
FIFO stock/inventory accounting, cash and loan ledgers, profit-share settlement between merchants,
an OTC marketplace, and an in-app chat with WebRTC voice/video calling.

Backend is **Supabase** (Postgres + RLS + Realtime + Storage + Edge Functions). There is no
separate application server; the React app talks to Supabase directly, and anything privileged
runs as a `SECURITY DEFINER` RPC or an Edge Function.

## 2. Commands

Scripts assume **npm** (`npm run …`) even though `package.json` declares a `packageManager` of
pnpm and the repo carries `package-lock.json`, `pnpm-lock.yaml`, and `bun.lock`. Pick the lockfile
matching whatever tool you use, and do not regenerate the others.

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server on **port 5000** (`server.host: "::"`) |
| `npm run build` | `build:preflight` (validate + typecheck) then `vite build` |
| `npm run build:dry-run` | `vite build` with no preflight — use for quick verification |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint 9 flat config |
| `npm test` | Vitest, single run |
| `npm run test:watch` | Vitest watch |
| `npm run validate` | Source-integrity guard over `OrdersPage`, `MerchantsPage`, `src/components/**` |
| `npm run guard:generated -- <files>` | Same guard, arbitrary files |
| `npm run guard:precommit` | Guard staged files; also typechecks + dry-run builds if critical UI files are staged |
| `npm run cap:sync` / `cap:android` / `cap:ios` | Build web, copy into native projects, open IDE |

There is **no CI workflow in this repo** (`.github/` does not exist). Verification is whatever you
run locally, so run it. `node_modules` is not committed — install before running anything.

Playwright (`playwright.config.ts`) imports `lovable-agent-playwright-config`, which is not a
declared dependency. E2E is driven by the Lovable agent environment, not by local scripts; do not
assume `npx playwright test` works here.

## 3. Source-integrity guard — read this before writing source files

`scripts/source-guard-utils.mjs` rejects source files (`.ts/.tsx/.js/.jsx`) that contain:

- **banned narrative phrases**: `the user is`, `i need to`, `continue where`, `previous response`
  (case-insensitive), plus in `validate-source.mjs`: `I will complete`, `Let's finish`,
  `I have implemented`, `Specifically, I have`
- **markdown-like lines**: a line starting with ```` ``` ````, `#`, `>`, `-`/`*`, `1.`, or `|…|`
- **TypeScript/JSX parse errors** (AST-level syntax diagnostics)

Practical consequences when editing `.ts`/`.tsx`:

- Never leave assistant narration in a source file.
- **Bullet-style comments break the build.** A comment line like `// - does a thing` matches the
  markdown pattern. Use prose comments (`// does a thing`) or the box-drawing style already used
  across `src/lib` (`// ─── Section ───`).
- Numbered comment lines (`// 1. step`) and `# `-prefixed lines are likewise rejected.

`scripts/safe-source-write.mjs` applies the same validation before writing a file.

## 4. Layout

```
src/
  pages/            merchant-facing route components (OrdersPage.tsx is 5.4k lines)
    admin/ auth/ customer/ merchant/
  features/         feature modules — the preferred home for new code
    admin/ auth/ chat/ customer/ dashboard/ marketplace/ merchants/
    orders/ p2p/ parent-order-fulfillment/ profile/ stock/
  components/
    ui/             shadcn/Radix primitives — check here before building any primitive
    layout/         AppLayout, CustomerLayout, AppSidebar, TopBar, PageHeader
    notifications/  ActivityCenter (merchant) + CustomerActivityCenter
    dashboard/ orders/ shared/
  hooks/            cross-feature hooks (settlements, ledgers, notifications, push, …)
  lib/              domain logic, stores, i18n, theme, tracker state/sync
    trading/        FIFO, profit service, monthly settlement, operator priority
    theme/          layout + theme definitions
  integrations/supabase/  generated client.ts and types.ts — do not hand-edit
  platform/         runtime.ts, install-gate.ts, native-bridge.tsx, haptics, biometrics
  services/ledgerImport/  file readers, parser, classifier, normalizer
  types/            domain.ts, notifications.ts, ledgerImport.ts
  test/             the bulk of the Vitest suite
supabase/
  migrations/       ~200 SQL migrations, timestamp-prefixed
  functions/        12 Deno Edge Functions
scripts/            source guards, seeds, icon generation, standalone SQL migrations
```

A feature module holds its own `components/`, `hooks/`, `api/`, `lib/`, `utils/`, `types.ts`.
**New work belongs in `src/features/<feature>/`**, not in a new top-level `src/pages` monolith.

Import alias: `@/*` → `src/*` (configured in `vite.config.ts`, `tsconfig*.json`, `vitest.config.ts`).

## 5. Stack conventions

Mirrors `AI_RULES.md`, which is authoritative on library choice:

- **Server state → TanStack Query v5.** Do not park Supabase data in Zustand or `useState`.
- **Client state → Zustand**, only for high-frequency/complex UI state. Existing stores:
  `src/lib/chat-store.ts`, `src/lib/call-store.ts`, `src/lib/p2p-rates.ts`.
  (`src/lib/os-store.ts` is a plain types/model module despite the name — not a store.)
- **App-wide context** → `AuthProvider` (`@/features/auth/auth-context`) and `ThemeProvider`
  (`@/lib/theme-context`).
- **Supabase** → always the singleton from `@/integrations/supabase/client`. Never call
  `createClient` again; the singleton is pinned on `globalThis` to survive HMR.
- **UI** → shadcn components in `src/components/ui` on top of Radix; Tailwind utilities for
  layout. Colors come from CSS variables (`hsl(var(--primary))` etc.) defined by the theme system
  — do not hardcode hex colors in components.
- **Forms** → React Hook Form + Zod resolvers.
- **Toasts** → `toast` from `sonner`. Icons → `lucide-react`. Dates → `date-fns`.
- **i18n** → `useT` from `@/lib/i18n` for every user-facing string. The app ships English and
  Arabic (RTL) and **defaults to `ar`**. `src/lib/i18n.ts` is a single flat translation map; add
  both `en` and `ar` for every new key.

TypeScript is deliberately loose: `strict: false`, `strictNullChecks: false`, `noImplicitAny: false`,
unused-vars lint disabled. Do not turn these on as a drive-by change — a large amount of code
depends on them.

## 6. Routing and access control

`src/App.tsx` holds every route. Three shells:

- **Public**: `/login`, `/signup`, `/verify-email`, `/reset-password`, `/auth/callback`,
  `/chat-preview`.
- **Customer portal** — `AuthGuard` → `CustomerGuard` → `CustomerLayout`, routes under `/c/*`
  (`/c/home`, `/c/orders`, `/c/wallet`, `/c/merchants`, `/c/chat`, `/c/notifications`,
  `/c/settings`).
- **Merchant app** — `AuthGuard` → `ProfileGuard` → `AppLayout`: `/dashboard`, `/trading/orders`,
  `/trading/stock`, `/trading/cash`, `/trading/p2p`, `/trading/calendar`, `/merchants`,
  `/merchants/:relationshipId`, `/chat`, `/marketplace`, `/crm`, `/admin`, `/settings`.

Guards live in `src/features/auth/guards/`. Legacy paths are handled by explicit `<Navigate>`
redirects at the bottom of the route table — add to that block rather than breaking old links.

`RouteErrorBoundary` in `App.tsx` catches render failures and, at most once per five minutes,
unregisters service workers, clears caches, and reloads. If you see mysterious auto-reloads in
development, that is what is firing.

## 7. Data layer and Supabase

- **Migrations** live in `supabase/migrations/`, named `YYYYMMDDHHMMSS_description.sql`. Older
  Lovable-generated ones use a UUID suffix instead of a description. Always add a new file;
  never edit a migration that has been applied. Many recent files are named `fix_*` — that is the
  established pattern for correcting a previously shipped migration.
- **Privileged writes go through RPCs** (`SECURITY DEFINER`) called via `supabase.rpc(...)`, so
  they bypass RLS deliberately. Reads rely on RLS: rows are scoped by
  `merchant_id = public.current_merchant_id()` or `user_id / customer_user_id = auth.uid()`.
  Whenever you add a table, add its RLS policies in the same migration.
- **Realtime** uses `postgres_changes` subscriptions filtered by `merchant_id` or
  `customer_user_id`. Always clean up channels on unmount.
- **Generated types**: `src/integrations/supabase/types.ts` is generated from the database schema
  — regenerate it rather than editing by hand, and expect merge noise in it.
- **Edge Functions** (`supabase/functions/`, Deno): `apply-migrations`, `call-session`,
  `fetch-fx-rate`, `notification-digest`, `notification-reminders`, `otc-lifecycle`, `p2p-cron`,
  `p2p-scraper`, `push-send`, `relay-token`, `settlement-decisions-cron`, `signaling-relay`.
  `supabase/config.toml` disables gateway JWT verification for `call-session`, `p2p-scraper`,
  and `push-send` — those functions verify (or intentionally skip) auth themselves.
  Deploy with `supabase functions deploy <name>`.

Secrets consumed only by Edge Functions (`RELAY_HMAC_SECRET`, `SIGNALING_RELAY_URL`, `TURN_*`,
`CLOUDFLARE_TURN_*`) are set in the Supabase dashboard, not in `.env`.

## 8. Key subsystems

### Shared order workflow (`src/features/orders/shared-order-workflow.ts`)

Bidirectional, approval-first orders on `public.customer_orders`. Either side can place; the
counterpart must approve.

- Statuses: `pending_customer_approval`, `pending_merchant_approval`, `approved`, `rejected`,
  `cancelled`.
- Columns that drive it: `workflow_status`, `placed_by_role`, `placed_by_user_id`,
  `approval_required_from_role`, `approved_by_user_id`, `rejected_by_user_id`,
  `rejection_reason`, `fx_rate` (mandatory), `revision_no`.
- RPCs: `create_customer_order_request` (atomic, includes cash links),
  `respond_customer_order_request` (approve/reject, notifies both sides),
  `edit_customer_order_request` (approved orders only — bumps `revision_no` and resets the
  workflow to counterpart approval).
- Listing helper: `listSharedOrdersForActor` — this is the current query path for both the
  customer orders page and `MerchantCustomerOrdersTab`. `listCustomerOrders` in
  `src/features/customer/customer-portal.ts` is the older path; prefer the shared one for
  anything workflow-aware.

### Parent-order fulfillment (`src/features/parent-order-fulfillment/`)

Phased/partial fulfillment of a parent order by multiple merchant executions, with USDT-based
phasing, aggregation (`aggregation.ts`, covered by `aggregation.test.ts`) and validation
(`validation.ts`). Backed by `order_executions` and a parent-order summary view.

### FX rates

`supabase/functions/fetch-fx-rate/index.ts` pulls the INSTAPAY V1 P2P market rate
(`https://api.instapay.me/api/v1/rates/<pair>`). It tries several response field names
(`rate`, `buy_price`, `price`, `buy`, `sell`), sanity-checks QAR→EGP into `0.1 … 1`, and falls
back to **0.27** with `isEstimate: true`. Client entry point:

```ts
import { getFxRate } from '@/features/orders/shared-order-workflow';
const { rate, isEstimate, fetchedAt } = await getFxRate('QAR', 'EGP');
```

There is no cache — the rate is fetched per load.

### Tracker state (FIFO inventory, cash, loans)

`src/lib/tracker-state.ts`, `tracker-helpers.ts` (`computeFIFO`), `tracker-sync.ts`,
`useTrackerState.ts`, `cash-sync.ts`, `tracker-backup.ts`, `supabase-vault.ts`.

Local-first: state loads from `localStorage`, then merges with the `tracker_snapshots` cloud row.
Several hard-won invariants are encoded there and are easy to break:

- `_cloudLoadedThisSession` gates overwrite-vs-merge. Before the cloud row has been read once,
  saves do read-merge-write so an empty PWA cannot wipe the cloud; after it, saves overwrite so
  deletes actually propagate.
- `_foreignIds` excludes rows that came from *other* merchant members' snapshots, so one user's
  row never absorbs another's data.
- `deletedLoanIds` are tombstones — deleted loans must stay deleted across merges.
- **Only the Cash Management page may reconcile-delete cloud cash rows.** Pass
  `isCashAuthority: true` from that page and nowhere else; every other page rides
  `cashAccounts`/`cashLedger` along incidentally and would destroy real data if it reconciled.

Read the comments in these files before touching sync logic; each one documents a bug that was
already paid for once.

### Chat and calling (`src/features/chat/`)

Zustand-backed chat (`src/lib/chat-store.ts`), Supabase Realtime for messages/presence/typing, and
WebRTC calls in `hooks/useWebRTC.ts` with signaling abstracted over multiple channels
(`lib/signaling/`: Supabase channel + WebSocket relay, coordinated by `multi-channel.ts`) and ICE
handling in `lib/resilient-ice.ts`. TURN is required for symmetric-NAT peers; ICE config comes
from the `call-session` Edge Function with `VITE_TURN_*` as client fallback. There is also a
privacy/DLP layer (`lib/privacy-engine.ts`, `hooks/useDLPGuard.ts`, watermarking, screenshot
protection).

### Notifications

`src/types/notifications.ts`, `src/lib/notification-router.ts` (deep-link routing by category),
`notification-grouping.ts`, `src/hooks/useNotifications.ts`, plus DB triggers that fan out on order
placement/approval/rejection/revision. Two centers: `ActivityCenter` (merchant) and
`CustomerActivityCenter` (customer, mounted in `CustomerLayout`). Push registration lives in
`src/hooks/usePushRegistration.ts`; delivery is the `push-send` Edge Function.

### Platform / PWA install gate

`src/platform/runtime.ts` exposes `isNativeApp()`, `isAndroid()`, `isIOS()`, `isWebBrowser()`,
`isInstalledPwa()` — keep native-only behavior behind these.

`src/platform/install-gate.ts` + `src/components/shared/MobileInstallPrompt.tsx` implement a
**blocking install gate**: a signed-in user on a mobile browser must install the app. Signed-out
users, native shells, and installed PWAs are exempt; desktop gets a soft prompt. Edge on Android
is handed off to Chrome via an `intent://` URL because Edge only creates a shortcut, which must
not count as an install. Install detection combines display-mode checks, iOS
`navigator.standalone`, the `android-app://` referrer, and
`navigator.getInstalledRelatedApps()` — the last needs `related_applications` in the manifest
pointing at the real origin, so set `PWA_ORIGIN` per environment at build time.
`VITE_FORCE_MOBILE_INSTALL=false` is the kill switch; `?pwa_debug=1` renders the resolved gate
state on screen. `README.md` §"Mandatory mobile app installation" has the full rationale.

## 9. Testing

Vitest + jsdom + Testing Library; setup in `src/test/setup.ts` (stubs `matchMedia`). Suite lives
mostly in `src/test/`, with co-located tests inside feature folders
(`aggregation.test.ts`, `customer-portal.test.ts`, `mirror-buyer-type.test.ts`,
`platform/__tests__/platform.test.ts`).

Coverage is concentrated on pure logic — FIFO (`consume-fifo`, `tracker-fifo`,
`fifo-average-separation`), settlement (`monthly-settlement`, `operator-priority`), sync
(`tracker-sync*`, `cash-sync`), notifications, the ledger importer, the install gate, and
WebRTC/signaling. UI-heavy pages are largely untested.

When you add domain logic, put it in a pure module and test it there rather than reaching for a
component test. Run `npm test` plus `npm run typecheck` before claiming anything works.

`TESTING.md` holds the manual end-to-end checklist (order workflow, FX rate, notifications,
bilingual/RTL). Use it for anything touching the order lifecycle.

## 10. Working agreements

These come from `.kiro/steering/` and hold for AI assistants here:

- **Inspect before editing.** Read the file first; make the smallest correct change. Do not
  refactor unrelated pages, tabs, shared layouts, or business logic along the way.
- **Verify with real commands** — `npm run typecheck`, `npm test`, `npm run build:dry-run` — and
  report the actual output. If verification fails, fix it and rerun.
- **Never claim something works because it should.** UI, WebRTC, PWA, and mobile behavior are only
  "working" once tested on the real device/browser. Say "pushed — please test", not "this is
  fixed".
- Preserve existing UI/UX unless a redesign was explicitly requested.

Commit messages are short imperative summaries, frequently with a PR number suffix — e.g.
`Group customer loans by customer with expandable order/payment detail`,
`Fix cross-tab cash data loss: only Cash Management page may reconcile-delete cloud rows (#150)`.

## 11. Gotchas

- **`.env` is committed** and contains Supabase and TURN values. Do not add new secrets to it and
  do not echo its contents into logs, PRs, or issues. `.env.local` is gitignored.
- `src/lib/auth-context.tsx` is **dead code** — nothing imports it. The live provider is
  `@/features/auth/auth-context`. Do not "fix" the unused one.
- `src/pages/OrdersPage.tsx` (5.4k lines) and `src/features/stock/components/CashManagement.tsx`
  (2.3k lines) are monoliths and are also on the source-guard critical list, so touching them
  triggers a typecheck + dry-run build in the pre-commit hook. Budget time accordingly.
- `src/lib/demo-mode.ts` is hardwired to `false` — demo mode is disabled in production.
- `CTempeslint_out.json` (1.8 MB) is stray tool output; `youthful-satoshi/` is empty. Neither is
  part of the build.
- `Migrate/` and `Lovable Cutover/` are one-off SQL dumps from the Lovable→Supabase cutover, not
  the live migration path. `scripts/migrations/*.sql` are standalone messaging-OS scripts, separate
  from `supabase/migrations/`.
- Auth redirect URLs must be allow-listed in Supabase for web *and* the Capacitor deep-link
  scheme `com.taheito26sys.corerefactorinitiative://login-callback` /
  `://reset-password-callback`. See `README.md` §"Auth redirect configuration".
- Service workers are aggressively cleaned up on boot (`App.tsx`), and Workbox is set to
  `skipWaiting` + `clientsClaim` with `autoUpdate`. Stale-cache symptoms usually mean the deploy
  has not landed yet — check `__APP_BUILD_ID__` in the console.
- Native `android/` and `ios/` projects are generated locally via Capacitor and are not meant to
  be committed.

## 12. Related documents

| File | Contents |
| --- | --- |
| `README.md` | Setup, Capacitor pipeline, install gate, auth redirect configuration |
| `AI_RULES.md` | Tech stack and library-usage rules (authoritative on library choice) |
| `TESTING.md` | Manual end-to-end test checklist |
| `RISKS.md` | Known risks |
| `P2P_MARKET_SPEC.md` | P2P market page specification |
| `EGP_IMPLEMENTATION.md` | EGP corridor implementation notes |
| `WORKFLOW_REDESIGN_SUMMARY.md` | Order workflow redesign background |
| `DEPLOYMENT_SUMMARY.md`, `DEPLOY_INSTRUCTIONS.md` | Deployment notes (Vercel) |
| `.kiro/steering/*.md` | Execution-mode and verification rules |
| `.kiro/specs/*/` | Feature specs (parent-order-fulfillment, customer-portal-rebuild) |

Several of these are point-in-time snapshots written during a specific change and have not been
maintained since. Treat the code and migrations as the source of truth when they disagree.
