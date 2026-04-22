# Shared Merchant↔Customer Order Workflow Redesign

## Overview

This implementation replaces the legacy quote/payment workflow with a simple, approval-first order workflow that gives merchants and customers parity in cash management and order control.

## Key Changes

### 1. Database Schema (Migration: 20260422000000_shared_order_workflow_redesign.sql)

#### Extended `customer_orders` Table
- `workflow_status` - States: `pending_customer_approval`, `pending_merchant_approval`, `approved`, `rejected`, `cancelled`
- `placed_by_role` - Who created the order: `merchant` or `customer`
- `placed_by_user_id` - UUID of the actor who created it
- `approval_required_from_role` - Who must approve next
- `approved_by_user_id` - UUID of who approved
- `approved_at` - Timestamp of approval
- `rejected_by_user_id` - UUID of who rejected
- `rejected_at` - Timestamp of rejection
- `rejection_reason` - Optional reason for rejection
- `revision_no` - Increments when edited after approval
- `edited_from_order_id` - References original order if this is an edit

#### New Table: `customer_order_cash_links`
Normalized cash account linking with constraints:
- `order_id` - References the order
- `owner_role` - `merchant` or `customer`
- `cash_account_id` - References `cash_accounts` table
- `amount` - Optional amount
- `currency` - Optional currency
- `link_kind` - `send`, `receive`, `settlement`, or `reserve`
- Unique constraint on `(order_id, owner_role, link_kind)`

### 2. RPC Layer

#### `create_customer_order_request()`
Creates an order with correct initial approval state:
- Merchant-placed → `pending_customer_approval`
- Customer-placed → `pending_merchant_approval`
- Cash links created atomically in same transaction
- Returns fully populated order row

#### `respond_customer_order_request()`
Approve or reject pending orders:
- Only the required approver can call
- Approve → `approved` status
- Reject → `rejected` status with optional reason
- Updates actor and timestamp fields

#### `edit_customer_order_request()`
Edit approved orders:
- Increments `revision_no`
- Resets workflow to counterpart approval
- Updates cash links transactionally
- Emits notification after commit

### 3. Frontend Components

#### MerchantCustomerOrdersTab.tsx
- **Removed**: Quote form, quote/payment status filters
- **New**: Approval UX with approve/reject buttons
- **Order Creation**: Calls new `createSharedOrderRequest()` RPC
- **Cash Account**: Selected in same transaction, no fallback updates
- **Editing**: Uses `editSharedOrder()` RPC
- **Approval**: Uses `respondSharedOrder()` RPC

#### CustomerOrdersPage.tsx
- **Replaced**: Old quote/payment workflow with approval-first UX
- **Order Creation**: Calls `createSharedOrderRequest()`
- **Approval**: Customer can approve/reject when order awaits their approval
- **Editing**: Customer can edit approved orders (resets to merchant approval)
- **Revision Tracking**: Shows revision numbers
- **Status Display**: Clear workflow status badges

#### CustomerWalletPage.tsx
- **Removed**: localStorage-only account storage
- **New**: DB-backed `cash_accounts` table
- **CRUD**: Add, edit, delete accounts (persisted to DB)
- **Refresh**: Accounts reload from DB on page refresh and across devices
- **Query Invalidation**: Realtime subscription to account changes
- **RLS**: Customers can only access their own accounts

### 4. Shared Helpers (src/features/orders/shared-order-workflow.ts)

Type-safe wrappers for all RPC calls:
- `createSharedOrderRequest()` - Type-safe order creation
- `respondSharedOrder()` - Type-safe approve/reject
- `editSharedOrder()` - Type-safe order editing
- `listSharedOrdersForActor()` - Query helper for merchants and customers
- `getSharedOrderWithLinks()` - Fetch order + cash links together
- Workflow status helpers: `isApproved()`, `isRejected()`, `canApproveOrder()`, etc.

## Business Rules Enforced

### Merchant → Customer Flow
1. Merchant places order → `pending_customer_approval`
2. Customer approves → `approved` (final)
3. If customer edits after approval → increments revision, back to `pending_customer_approval`

### Customer → Merchant Flow
1. Customer places order → `pending_merchant_approval`
2. Merchant approves → `approved` (final)
3. If merchant edits after approval → increments revision, back to `pending_merchant_approval`

### Cash Account Parity
- Both merchant and customer must choose cash accounts
- Cash links created atomically with order (no second fallback update)
- DB-backed, persists across devices and refreshes
- Customer has same capability as merchant

### Single Source of Truth
- One `customer_orders` table for both sides
- RLS ensures each side sees only their orders
- Same status fields, same read fields
- Notifications only after successful commit

## Pass/Fail Tests

### PASS Criteria
- ✅ Merchant creates order → customer list shows immediately
- ✅ Customer creates order → merchant list shows immediately
- ✅ Merchant-placed order starts as `pending_customer_approval` only
- ✅ Customer-placed order starts as `pending_merchant_approval` only
- ✅ Approval goes directly to `approved`
- ✅ Rejection goes directly to `rejected`
- ✅ Editing approved order increments revision and reopens counterpart approval
- ✅ Merchant cash account link persists in DB
- ✅ Customer cash account link persists in DB
- ✅ Refresh keeps both order and cash links visible
- ✅ Notification exists only when order row exists

### FAIL Scenarios (Prevented)
- ✅ Notification without order row (no silent success)
- ✅ Order exists only for one side (RLS ensures visibility)
- ✅ Cash link in second fallback update (atomic transactions)
- ✅ Customer cash accounts in localStorage (all in DB now)
- ✅ Old quote/payment phases active (removed from this workflow)

## Migration Path

1. Deploy migration: Creates new columns, tables, RPCs
2. Deploy frontend: Updates use new RPCs
3. Old `mirror_merchant_customer_order` RPC remains (OrdersPage uses it for trading)
4. New orders use approval workflow
5. Legacy orders continue with old status values (unaffected by new constraints)

## Files Changed

- ✅ `supabase/migrations/20260422000000_shared_order_workflow_redesign.sql`
- ✅ `src/features/orders/shared-order-workflow.ts` (new)
- ✅ `src/features/merchants/components/MerchantCustomerOrdersTab.tsx`
- ✅ `src/pages/customer/CustomerOrdersPage.tsx`
- ✅ `src/pages/customer/CustomerWalletPage.tsx`

## Implementation Notes

- Cash account selection happens at order creation, not after
- Edits increment revision and re-trigger counterpart approval
- Notifications fire after transaction commits (using trigger)
- RLS policies ensure orders visible only to authorized parties
- No migration of existing orders; new workflow applies to new orders only
- Type safety via TypeScript interfaces and runtime validation

## Future Considerations

- Archive/cancellation workflow beyond simple rejection
- Order expiration (approved orders that expire)
- Multi-approver workflows (if business rules change)
- Historical tracking of approval chain
