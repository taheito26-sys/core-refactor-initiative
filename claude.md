# Core Refactor Initiative - Claude Instructions

## Overview
This document contains critical information for Claude when working on the core-refactor-initiative project. It includes system architecture, API endpoints, RLS policies, and testing procedures.

## 1. Order Workflow System

### Architecture
- **Type**: Bidirectional approval-first workflow
- **Table**: `public.customer_orders`
- **States**: 
  - `pending_customer_approval` - Merchant placed order, awaiting customer approval
  - `pending_merchant_approval` - Customer placed order, awaiting merchant approval
  - `approved` - Both parties approved
  - `rejected` - One party rejected
  - `cancelled` - Order cancelled

### Key Columns
- `workflow_status`: Current approval state
- `placed_by_role`: Who initiated ('merchant' or 'customer')
- `placed_by_user_id`: User who initiated
- `approval_required_from_role`: Who needs to act next
- `approved_by_user_id`: Who approved (if approved)
- `rejected_by_user_id`: Who rejected (if rejected)
- `rejection_reason`: Reason for rejection (if rejected)
- `fx_rate`: FX rate for conversion (mandatory)
- `revision_no`: Revision number for edits (defaults to 1)

### Core RPCs
1. **create_customer_order_request**
   - Path: `src/features/orders/shared-order-workflow.ts`
   - Creates order atomically with cash links
   - Requires: connection_id, placed_by_role, amount, currencies, fx_rate

2. **respond_customer_order_request**
   - Approves or rejects order
   - Sends notifications to both parties
   - Must be called by the required approver

3. **edit_customer_order_request**
   - Only works on approved orders
   - Increments revision number
   - Resets workflow to counterpart approval

## 2. FX Rate System

### Critical: INSTAPAY V1 P2P Market Rate
**Endpoint**: `https://api.instapay.me/api/v1/rates/qar-egp`

**Expected Response Format** (from P2P market guide):
```json
{
  "rate": 0.27,  // QAR to EGP conversion
  "buy_price": 0.27,  // Alternative field
  "price": 0.27,  // Another alternative
  "timestamp": "2024-04-22T10:00:00Z",
  "source": "instapay_v1"
}
```

**Implementation**: `supabase/functions/fetch-fx-rate/index.ts`
- Must try multiple field extraction paths: rate, buy_price, price, buy, sell
- Validates rate is between 0.1 and 1 for QAR→EGP
- Falls back to 0.27 on any error
- Logs all responses for debugging

**Usage in Components**:
```typescript
import { getFxRate } from '@/features/orders/shared-order-workflow';
const { rate, isEstimate, fetchedAt } = await getFxRate('QAR', 'EGP');
```

### Fallback Rate
- Default: **0.27 QAR = 1 EGP**
- Used when API fails
- Always marks as `isEstimate: true`

## 3. Notification System

### Notification Triggers
Located in: `supabase/migrations/20260423000000_customer_order_notifications.sql`

**Triggers Send Notifications For:**
1. Order Placement
   - Merchant places for customer → Customer notified
   - Customer places for merchant → Merchant notified

2. Order Approval
   - Merchant approves → Customer notified
   - Customer approves → Merchant notified

3. Order Rejection
   - Either party rejects → Counterpart notified with reason

4. Order Edits (Revisions)
   - Edit triggers re-approval request
   - Counterpart notified with revision number

### Notification Categories
- `customer_order`: General order notifications
- Entity Type: Always `customer_order`
- Targets:
  - **Merchant**: `/trading/orders`
  - **Customer**: `/customer/orders`

### ActivityCenter Components
1. **MerchantActivityCenter** (src/components/notifications/ActivityCenter.tsx)
   - Top nav bell icon
   - Categories: All, Approvals, Deals, Orders, Invites, Messages, System
   - Inline actions for approvals

2. **CustomerActivityCenter** (src/components/notifications/CustomerActivityCenter.tsx)
   - Top nav bell icon
   - Categories: All, Approvals, Orders, Messages, System
   - Inline actions for order approval/rejection
   - Integrated into CustomerLayout header

### Real-time Updates
- Uses Supabase `postgres_changes` subscriptions
- Filters by `merchant_id` or `customer_user_id`
- Green "Live" indicator when connected
- Automatic reconnect on disconnect

## 4. RLS Policies

### customer_orders Table
```sql
-- Merchants can see their orders
merchant_id = public.current_merchant_id()

-- Customers can see their orders
customer_user_id = auth.uid()

-- RPCs bypass RLS (SECURITY DEFINER)
```

### cash_accounts Table
```sql
-- Users can only see their own accounts
user_id = auth.uid()
```

### customer_order_cash_links Table
```sql
-- Visible if user is merchant or customer of order
```

**Migration**: `supabase/migrations/20260422230000_add_customer_orders_rls_policies.sql`

## 5. Dashboard & Orders Pages

### CustomerHomePage (Dashboard)
- **Path**: `src/pages/customer/CustomerHomePage.tsx`
- **Query**: `listCustomerOrders` from customer-portal.ts
- **Status**: Uses OLD query system, shows empty with new workflow
- **Fix Required**: Update to use `listSharedOrdersForActor` from shared-order-workflow.ts

### CustomerOrdersPage (Orders)
- **Path**: `src/pages/customer/CustomerOrdersPage.tsx`
- **Query**: `listSharedOrdersForActor` from shared-order-workflow.ts
- **Status**: ✅ Working - Shows orders correctly
- **Displays**: QAR amount, EGP delivered (calculated), FX rate, date only

### MerchantCustomerOrdersTab
- **Path**: `src/features/merchants/components/MerchantCustomerOrdersTab.tsx`
- **Query**: `listSharedOrdersForActor` with merchantId
- **Subscription**: Real-time via postgres_changes
- **Status**: ✅ Working (after RLS migration deployed)

## 6. Mobile Responsiveness

### Order Cards (Updated)
```css
/* Desktop */
grid-cols-2, gap-3, p-4, text-2xl

/* Mobile */
grid-cols-1 sm:grid-cols-2, gap-2 sm:gap-3, p-3 sm:p-4, text-xl sm:text-2xl
```

**Applied to**: CustomerOrdersPage.tsx (lines 453, 478)

## 7. Testing Checklist

### Before Deployment
- [ ] Apply all migrations to Supabase database
- [ ] Deploy Edge Function: `fetch-fx-rate`
- [ ] Verify RLS policies are active

### FX Rate Testing
- [ ] Order form loads FX rate from INSTAPAY V1
- [ ] Rate displays as "1 QAR = X EGP"
- [ ] Falls back to 0.27 if API unavailable
- [ ] Shows "may change" disclaimer for estimates
- [ ] Edge Function logs visible in Supabase

### Order Workflow Testing
- [ ] Create order as merchant → Customer sees notification
- [ ] Create order as customer → Merchant sees notification
- [ ] Click notification → Navigates to order details
- [ ] Inline approve → Order marked approved, counterpart notified
- [ ] Inline reject → Order marked rejected, reason sent
- [ ] Edit approved order → Revision incremented, counterpart needs approval

### Dashboard Testing
- [ ] CustomerHomePage shows orders (not empty)
- [ ] Displays QAR amount, EGP delivered, FX rate
- [ ] Mobile view is responsive and readable
- [ ] Pagination/scrolling works if many orders

### Notification Center Testing
- [ ] Bell icon appears in top nav bar
- [ ] Shows unread count badge
- [ ] Categories filter correctly
- [ ] Real-time: Green "Live" indicator shows
- [ ] Inline actions work (approve/reject)
- [ ] Mark all read button works
- [ ] Navigate to notification details works
- [ ] Mobile responsive (fits on phone screen)

### Bilingual Testing (AR/EN)
- [ ] Notification titles in correct language
- [ ] Order amounts display with correct separators
- [ ] All UI labels translated
- [ ] RTL layout correct for Arabic

## 8. Critical Bug Fixes

### Issue 1: Dashboard Empty Data
- **Cause**: Using old `listCustomerOrders` query with old column names
- **Fix**: Update CustomerHomePage.tsx to use `listSharedOrdersForActor`
- **File**: `src/pages/customer/CustomerHomePage.tsx`

### Issue 2: FX Rate Inaccuracy
- **Cause**: INSTAPAY endpoint may return different field names
- **Fix**: Try multiple field extraction paths in Edge Function
- **File**: `supabase/functions/fetch-fx-rate/index.ts`
- **Verified**: Validates rate is reasonable (0.1-1 for QAR→EGP)

### Issue 3: Notification Center Not Visible
- **Cause**: May not be in correct import or layout
- **Fix**: Check CustomerActivityCenter import in CustomerLayout.tsx
- **File**: `src/components/layout/CustomerLayout.tsx`
- **Status**: Added to header (line ~81)

## 9. Deployment Order

1. **Migrations** (in order):
   - `20260422000000_shared_order_workflow_redesign.sql`
   - `20260422200000_add_fx_rate_and_optional_cash.sql`
   - `20260422210000_fix_cash_links_and_add_live_fx.sql`
   - `20260422220000_fix_cash_account_nullable.sql`
   - `20260422230000_add_customer_orders_rls_policies.sql`
   - `20260423000000_customer_order_notifications.sql`

2. **Edge Functions**:
   - `supabase functions deploy fetch-fx-rate`

3. **Code Changes**:
   - Verify all imports are correct
   - Test locally before pushing to production

## 10. Debug Commands

### Check RLS Policies
```sql
SELECT schemaname, tablename FROM pg_tables 
WHERE tablename = 'customer_orders';

-- Check policies
SELECT * FROM pg_policies 
WHERE tablename = 'customer_orders';
```

### Check Notifications
```sql
SELECT * FROM public.notifications 
WHERE category = 'customer_order' 
ORDER BY created_at DESC LIMIT 10;
```

### Test FX Rate Endpoint
```bash
curl "https://api.instapay.me/api/v1/rates/qar-egp" \
  -H "Content-Type: application/json"
```

## 11. Known Limitations

1. **FX Rate Cache**: Currently no caching, calls INSTAPAY on every load
   - Suggestion: Implement 5-minute cache in Edge Function
   
2. **Notification Spam**: No deduplication for repeated edits
   - Suggestion: Add 30-second dedup window

3. **Bulk Operations**: No bulk approve/reject for multiple orders
   - Suggestion: Add batch RPC for future

## 12. Files Modified

### New Files
- `src/components/notifications/CustomerActivityCenter.tsx`
- `supabase/functions/fetch-fx-rate/index.ts`
- `supabase/migrations/20260423000000_customer_order_notifications.sql`
- `supabase/migrations/20260422230000_add_customer_orders_rls_policies.sql`

### Modified Files
- `src/components/layout/CustomerLayout.tsx` (added ActivityCenter import)
- `src/pages/customer/CustomerOrdersPage.tsx` (responsive grid)
- `src/features/orders/shared-order-workflow.ts` (FX rate enhancements)

## 13. Version History

- **v1.0** (2024-04-22): Initial shared order workflow + notification center
- **v1.1** (2024-04-22): FX rate accuracy improvements, RLS policies
- **v1.2** (2024-04-23): Customer notification center, bidirectional notifications

---

**Last Updated**: 2024-04-23
**Status**: Requires testing and deployment
**Test Before Deploying**: YES - Critical system
