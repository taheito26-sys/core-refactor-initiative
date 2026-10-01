# Customer identity & lifecycle — end-to-end design

Status: implemented 2026-10-01 (see "Changes shipped" at the bottom).

## 1. Principles

1. **One customer = one Customer ID.** The merchant-side record id
   (`Customer.id` in the tracker snapshot, displayed as `CUS-XXXXXX`) is the
   buyer's permanent identity inside a merchant's book. Every trade
   (`Trade.customerId`), loan (`CustomerLoan.customerId`) and statement link
   (`buyer_statement_links.customer_id`) points at it. It never changes after
   creation.
2. **Identity ≠ name ≠ login.** Three separate things:

   | Concept | Where it lives | Mutable? |
   | --- | --- | --- |
   | Customer ID (`CUS-…`) | `Customer.id` | never |
   | Display name | `Customer.nameEn` / `nameAr`, portal `customer_profiles.display_name(_ar)` | yes |
   | Legacy name key | `Customer.name` (set once at creation, see CLAUDE.md §3a) | never |
   | Login ID (username) | `auth.users.email` = `<username>@customers.local` | via auth only |
   | Portal account id | `auth.users.id` (UUID) | never |

   None of the IDs is derived from a name or username, so renaming a buyer or
   changing their login never splits their history.
3. **One explicit link between the merchant record and the portal account.**
   - Client side: `Customer.portalUserId` (the portal account UUID).
   - Server side: `customer_merchant_connections.merchant_customer_id`
     (the `CUS` id), so the database also knows which record a connection
     belongs to.
   Name matching is only a *fallback* for legacy data that predates the link,
   never the primary path.
4. **Orders flow one way, idempotently.** A trade recorded on the Orders page
   for a linked customer is mirrored into `customer_orders` keyed by
   `source_trade_id = Trade.id` (unique per merchant). Re-running the sync can
   never duplicate a row.

## 2. Lifecycle

### 2.1 Create (merchant side)
Orders page "new buyer" or Customers tab "Add customer" → new `Customer` with a
fresh `uid()`. No portal account yet. Duplicate names (any language variant)
are rejected at creation.

### 2.2 Create portal login (merchant gives the buyer access)
Customers tab → "Create login" on an existing customer:
1. Edge function `admin-create-customer-login` receives `{ username, password,
   displayName, phone, customerId }`.
2. Creates the auth user (`<username>@customers.local`, `user_metadata.portal =
   'customer'`).
3. Upserts `profiles` (role `customer`, status `approved`), `customer_profiles`
   and the `customer_merchant_connections` row (status `active`,
   `merchant_customer_id = customerId`). All upserts, so the signup trigger
   having already created a row is not an error.
4. Any failure after the auth user exists deletes that auth user again, so a
   failed attempt never burns the username.
5. Client stores `portalUserId` on the local `Customer` and syncs that
   customer's existing trades to the portal (notifications suppressed for the
   backfill).

### 2.3 Self-signup buyer connects to a merchant
Buyer signs up → onboarding → connects with a merchant code (connection
`pending`/`active`). They appear in the merchant's Customers tab as a
"portal-only" row. The first time the merchant records an order for them, the
row is materialized as a local `Customer` whose id **is** the portal UUID, so
the link is implicit (`id === portalUserId`).

### 2.4 Record an order (Orders page)
1. Buyer resolved to a `Customer.id` (picked from list or name-matched).
2. Portal link resolved (`resolveCustomerPortalUserId`): explicit
   `portalUserId` → connection `merchant_customer_id` → id-is-portal-UUID →
   unique name match (legacy fallback), across the buyer's identity group.
3. Trade saved with `buyerType: 'connected_customer'` + `connectedCustomerId`
   when linked.
4. Mirrored immediately via `mirror_merchant_customer_order(...,
   p_source_trade_id)`; the row is written `workflow_status = 'approved'` (a
   recorded sale, not a request) and the buyer gets one "recorded your order"
   notification. The portal Orders page picks it up via its realtime channel.

### 2.5 Existing customers who get linked later
Customers tab → "Sync to portal" pushes every non-voided trade of that
customer's identity group. Idempotent; safe to press repeatedly.

### 2.6 Edit
Name/phone/tier edits never touch `Customer.id` or `Customer.name`, so the link
and history survive.

### 2.7 Delete (merchant side)
- A customer with trades or loans cannot be deleted (it would orphan history
  and drop orders from the buyer's portal). The merchant is told how many.
- A customer with no history is removed and **tombstoned**
  (`deletedCustomerIds`) so another device's stale snapshot cannot resurrect
  it.
- If linked to a portal account, the connection is set to `blocked` (buyer
  keeps their account and past orders, but can no longer place orders with
  this merchant).

### 2.8 Delete (platform admin)
`delete_customer_by_admin` removes the portal profile + connections. It is now
restricted to platform admins (previously callable by any signed-in user).

## 3. Gap analysis (state before this change)

| # | Gap | Effect | Fix |
| --- | --- | --- | --- |
| G1 | New trades never set `buyerType` / `connectedCustomerId`, and the mirror required both | **No order recorded on the Orders page ever reached the customer portal**; every trade was stamped `skipped_not_connected` | Resolve the portal link from the customer record, stamp it on the trade, mirror on save |
| G2 | Client mirror never passed `p_source_trade_id`; dedup used a ±60s window on `created_at` (the bug fixed server-side on 2026-09-09) | Manual "push" could duplicate orders | Pass `p_source_trade_id`; drop the fuzzy window |
| G3 | `mirror_merchant_customer_order` left `workflow_status` NULL; portal renders NULL as **Cancelled** | Every mirrored order looked cancelled to the buyer | RPC writes `approved`; migration corrects existing mirrored rows |
| G4 | "Create login" didn't link the new account to the customer record | Two rows for one buyer (one with all trades, one "Connected" with 0), relying on name matching | `customerId` → `merchant_customer_id` + `Customer.portalUserId` |
| G5 | Migration `20260928235408` reused the trigger name `on_auth_user_created`, **dropping the `handle_new_user` trigger** | New signups get no `profiles` row (no pending-approval gate, edge-function role update silently matches 0 rows) | Restore it under its own name; backfill rows for merchant-created customer logins |
| G6 | Same migration auto-creates a `customer_profiles` row for **every** new auth user | (a) "Create login" now fails with a unique-violation 500 after the auth user is created (username burned); (b) a brand-new merchant signup is routed to `/c/home` instead of merchant onboarding | Only auto-create for merchant-created portal logins; edge function upserts; client only "ensures" a customer profile for customer-role accounts |
| G7 | `delete_customer_by_admin` is `SECURITY DEFINER`, granted to `authenticated`, with no role check | Any signed-in user could delete any customer's profile/connections | Require `has_role(auth.uid(), 'admin')` |
| G8 | Merchant-side delete didn't tombstone and didn't check history | Deleted buyers could resurrect from another device; deleting a buyer with trades orphaned them | History guard + tombstone + connection block |
| G9 | Cash Management's portal-link picker only loaded connections with status `accepted`; merchant-created logins are `active` | "Sync loan statement to wallet" never offered for those buyers | Load `active` and `accepted` |
| G10 | Mirrored sales fired "placed an order for approval" notifications | Misleading text; a bulk sync would spam the buyer | "recorded your order" text; backfill syncs are silent |

## 4. Not changed (deliberately)

- Existing trades are **not** auto-pushed to portals in bulk. Old trades keep
  their `skipped_not_connected` status until the merchant presses "Sync to
  portal" for that customer (or creates their login), so no buyer suddenly
  receives months of history unannounced.
- Existing `Customer` records are not rewritten; links for legacy pairs are
  resolved at read time. Only explicit actions (create login, sync) persist a
  `portalUserId`.
- Empty `customer_profiles` rows already created for merchants by the
  2026-09-28 trigger are left in place; merchants with a merchant profile are
  still routed to the merchant app.

## 5. Known remaining gaps (follow-ups)

- **Edits and voids after mirroring are not propagated.** Changing a trade's
  amount/rate, or voiding it, on the Orders page does not update or cancel the
  portal order already mirrored from it. Needs an `update/cancel by
  source_trade_id` RPC called from the edit and void paths.
- Loan statements in the portal wallet still depend on a
  `buyer_statement_links` row per currency (Cash Management → sync to
  wallet). Linking a login does not create those automatically yet.
- Self-signup buyers who never finish onboarding have no `customer_profiles`
  row; they are routed to `/c/onboarding`, which is intended.

## 6. Deployment

1. Apply migration `supabase/migrations/20261001120000_customer_identity_lifecycle.sql`.
2. Deploy the edge function: `supabase functions deploy admin-create-customer-login`.
3. Ship the web build. The client is backward compatible with an un-migrated
   database (it reads connections with `select('*')` and the mirror RPC
   already accepts `p_source_trade_id`), but mirrored orders only show as
   "Approved" once the migration is applied.
