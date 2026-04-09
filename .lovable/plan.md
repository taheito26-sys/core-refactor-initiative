

# Customer Portal — End-to-End Implementation Plan

## Overview

Build a separate "Customer" user role and portal that lets end-customers sign up, discover merchants, view their published liquidity (USDT/Cash availability), chat with them, and manage their own transaction history — all within the existing app shell, fully localized (AR/EN).

---

## Architecture

```text
                   ┌──────────────┐
                   │  Signup Page  │
                   │ (role picker) │
                   └──────┬───────┘
                          │
              ┌───────────┴───────────┐
              ▼                       ▼
     Customer Onboarding      Merchant Onboarding
     (name, phone, region)    (existing flow)
              │                       │
              ▼                       ▼
     CustomerLayout             AppLayout
     (customer routes)         (merchant routes)
```

The `profiles` table gains a `role` column (`merchant` | `customer`), and `ProfileGuard` routes users to the correct layout based on role.

---

## Database Changes (Single Migration)

### 1. Add `role` column to `profiles`
- `ALTER TABLE profiles ADD COLUMN role text NOT NULL DEFAULT 'merchant'` — backwards compatible; all existing users stay as merchants.

### 2. Create `customer_profiles` table
- `id`, `user_id` (ref auth.users), `display_name`, `phone`, `region`, `preferred_currency`, `status` (active/suspended), `created_at`, `updated_at`
- RLS: users can only read/update their own row.

### 3. Create `customer_merchant_connections` table
- `id`, `customer_user_id`, `merchant_id` (text, matches merchant_profiles.merchant_id), `status` (pending/active/blocked), `created_at`
- RLS: customer can see/insert own rows; merchant can see connections to them.
- This is the "add merchant by ID/code" relationship.

### 4. Create `customer_orders` table
- `id`, `customer_user_id`, `merchant_id`, `connection_id`, `type` (buy/sell), `amount`, `currency`, `rate`, `status` (pending/confirmed/completed/cancelled), `note`, `created_at`, `updated_at`
- RLS: customer sees own; merchant sees orders to them.

### 5. Create `customer_messages` table
- `id`, `connection_id`, `sender_user_id`, `sender_role` (customer/merchant), `content`, `read_at`, `created_at`
- RLS: both sides of the connection can read/insert.
- Add to `supabase_realtime` publication.

### 6. Notification trigger
- On new `customer_orders` INSERT → notify the merchant.
- On new `customer_messages` INSERT → notify the counterparty.

---

## Frontend — New Files

### A. Customer Onboarding (`src/pages/customer/CustomerOnboardingPage.tsx`)
- Simple form: display name, phone, region, preferred currency.
- Inserts into `customer_profiles` + sets `profiles.role = 'customer'`.

### B. Customer Layout (`src/components/layout/CustomerLayout.tsx`)
- Simplified sidebar/bottom nav: Home, My Merchants, Orders, Chat, Settings.
- Uses `<Outlet />` like `AppLayout`.

### C. Customer Guard (`src/features/auth/guards/CustomerGuard.tsx`)
- Checks `profile.role === 'customer'` and `customer_profiles` exists, otherwise redirects.

### D. Customer Pages

| Page | Path | Purpose |
|------|------|---------|
| `CustomerHomePage` | `/c/home` | Welcome, quick stats (pending orders, connected merchants) |
| `CustomerMerchantsPage` | `/c/merchants` | Search/add merchants by ID or code; see connected merchants with their published liquidity (USDT/Cash status from `merchant_liquidity_profiles`) |
| `CustomerOrdersPage` | `/c/orders` | Place buy/sell requests to connected merchants; view order history |
| `CustomerChatPage` | `/c/chat` | Real-time messaging with connected merchants |
| `CustomerSettingsPage` | `/c/settings` | Profile edit, language, theme |

### E. Merchant Search & Connect (`src/features/customer/components/MerchantSearch.tsx`)
- Search by `merchant_code` or `merchant_id` (respects `discoverability` column).
- Shows merchant display name, region, and published liquidity status.
- "Connect" button creates a `customer_merchant_connections` row.
- Merchant receives a notification.

### F. Liquidity Viewer (`src/features/customer/components/MerchantLiquidityCard.tsx`)
- Read-only view of `merchant_liquidity_profiles` for connected merchants.
- Shows Cash and USDT availability (status/range/exact based on publish mode).

### G. Customer Chat (`src/features/customer/components/CustomerChat.tsx`)
- Reuses the bubble UI pattern from existing chat.
- Backed by `customer_messages` table with realtime subscription.
- Merchant side: new tab or inbox integration in existing Chat page showing customer conversations.

---

## Modified Files

| File | Change |
|------|--------|
| `src/App.tsx` | Add `/c/*` routes under `AuthGuard` + `CustomerGuard` + `CustomerLayout` |
| `src/features/auth/guards/ProfileGuard.tsx` | If `role === 'customer'`, redirect to `/c/home` instead of merchant routes |
| `src/pages/auth/SignupPage.tsx` | Add role picker toggle (Merchant / Customer) before signup |
| `src/pages/merchant/OnboardingPage.tsx` | No change (merchant-only) |
| `src/lib/i18n.ts` | Add ~60 customer-related keys (AR/EN) |
| `src/components/layout/AppSidebar.tsx` | No change (merchant-only sidebar stays) |
| `src/features/chat/pages/ChatWorkspacePage.tsx` | Add "Customers" tab showing `customer_messages` for merchant users |

---

## Merchant-Side Integration

- **Merchant receives customer connection requests** as notifications and can accept/block.
- **Merchant sees customer orders** in a new "Customer Orders" section (or tab on existing Orders page).
- **Merchant chats with customers** via existing Chat workspace with a "Customers" lane/tab.
- **Merchant liquidity** published via existing `merchant_liquidity_profiles` is visible to connected customers (RLS policy addition).

---

## Localization Keys (subset)

- `customerPortal`, `customerHome`, `myMerchants`, `searchMerchant`, `connectToMerchant`, `enterMerchantCode`, `merchantNotFound`, `connectionPending`, `connectionActive`, `placeOrder`, `buyUsdt`, `sellUsdt`, `orderPlaced`, `orderHistory`, `noConnectedMerchants`, `addMerchantByCode`, `availableLiquidity`, `customerOnboardTitle`, `customerOnboardDesc`, `customerDisplayName`, `customerPhone`, `customerRegion`, `customerChat`, `noMessages`, `typeMessage`

All with EN + AR values.

---

## RLS Policy Updates

- `merchant_liquidity_profiles`: Add SELECT policy for customers connected to that merchant.
- `merchant_profiles`: Add SELECT policy for customers searching public/merchant_id_only profiles (already partially covered by existing `discoverability` policy for authenticated users).

---

## Realtime

- `customer_messages` added to `supabase_realtime` publication.
- `customer_orders` added to `supabase_realtime` publication.
- `customer_merchant_connections` added to `supabase_realtime` publication.

---

## Implementation Order

1. Database migration (tables, RLS, triggers, realtime)
2. Auth flow changes (role picker on signup, ProfileGuard routing, CustomerGuard)
3. Customer onboarding page
4. Customer layout + routing in App.tsx
5. Merchant search & connect feature
6. Liquidity viewer for customers
7. Customer orders page
8. Customer chat (both sides)
9. Merchant-side customer inbox integration
10. Localization (all keys)
11. Notifications integration

---

## Technical Notes

- The `profiles.role` column determines routing at the guard level — no separate auth system needed.
- Customer routes are prefixed `/c/` to avoid collisions with merchant routes.
- The existing merchant app is completely unaffected unless you're viewing customer connections/orders.
- Customer chat is a separate table from `os_messages` to keep merchant-to-merchant messaging isolated.
- All customer tables use `user_id = auth.uid()` patterns for RLS consistency.

