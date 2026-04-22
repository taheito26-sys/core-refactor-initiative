# End-to-End Testing Guide

This document provides step-by-step instructions for testing all aspects of the core-refactor-initiative order workflow system.

## Prerequisites

1. Dev server running: `npm run dev` (should be on http://localhost:5000)
2. Supabase database connected with all migrations applied
3. Supabase Edge Function deployed: `fetch-fx-rate`
4. Two test accounts (one customer, one merchant) with established connection

## 1. Pre-Deployment Verification

### 1.1 TypeScript and Build Checks
```bash
npm run typecheck     # ✓ Should pass with no errors
npm run build:preflight  # ✓ Should pass all validation
npm run lint          # ✓ Should pass with no errors
```

**Expected Result**: All commands complete without errors or warnings.

### 1.2 Database Migration Status
In Supabase dashboard under SQL Editor:
```sql
SELECT version, name FROM schema_migrations ORDER BY version DESC LIMIT 10;
```

**Expected Migrations to Be Applied**:
- `20260422000000_shared_order_workflow_redesign.sql`
- `20260422200000_add_fx_rate_and_optional_cash.sql`
- `20260422210000_fix_cash_links_and_add_live_fx.sql`
- `20260422220000_fix_cash_account_nullable.sql`
- `20260422230000_add_customer_orders_rls_policies.sql`
- `20260423000000_customer_order_notifications.sql`

### 1.3 RLS Policies Verification
In Supabase SQL Editor:
```sql
SELECT tablename, policyname, permissive, roles, qual 
FROM pg_policies 
WHERE tablename = 'customer_orders' 
ORDER BY tablename, policyname;
```

**Expected Policies**:
- At least 2 policies (one for merchant, one for customer)
- Both using SECURITY DEFINER or auth functions

### 1.4 Edge Function Status
In Supabase dashboard under Functions:
- `fetch-fx-rate` should show as "Deployed"
- Recent invocation logs should be visible

Test the Edge Function:
```bash
curl "http://localhost:54321/functions/v1/fetch-fx-rate?source=qar&target=egp" \
  -H "Content-Type: application/json"
```

**Expected Response**:
```json
{
  "rate": 0.27,
  "source": "instapay_v1",
  "timestamp": "2024-04-23T..."
}
```

## 2. FX Rate Testing

### 2.1 FX Rate Loading in Order Form

**Test Scenario**: Create a new order and verify FX rate loads correctly

**Steps**:
1. Navigate to `/c/orders` (Customer Orders Page)
2. Click "Create New Order" or the "New" button
3. Wait for the FX rate input field to populate
4. Verify the FX rate displays one of these:
   - "0.27 QAR = 1 EGP" (fallback, if INSTAPAY unavailable)
   - Current INSTAPAY V1 rate (e.g., "0.28 QAR = 1 EGP")
   - "may change" disclaimer if rate is an estimate

**Expected Result**:
- ✓ FX rate field is populated within 2 seconds
- ✓ Rate is between 0.1 and 1.0 (reasonable for QAR→EGP)
- ✓ No error message appears
- ✓ "Loading..." state is brief

**Test Case 2.2**: Verify fallback behavior
1. In browser DevTools Console, check:
   ```javascript
   // This will show any fetch errors for the FX rate function
   console.log("Check Network tab for fetch-fx-rate requests")
   ```
2. Stop the INSTAPAY API (by mocking network failure in DevTools)
3. Refresh the order form
4. Verify it falls back to 0.27 rate

**Expected Result**:
- ✓ Falls back to 0.27 if API is unavailable
- ✓ Shows "may change" disclaimer
- ✓ User can still create order

### 2.3 FX Rate in Order Display

**Test Scenario**: Verify FX rate displays correctly in order cards

**Steps**:
1. Navigate to `/c/orders`
2. View existing orders in the list
3. Each order card should display:
   - Amount sent in QAR
   - Amount received in EGP (calculated from amount × fx_rate)
   - FX rate @ X.XXXX

**Expected Result**:
- ✓ QAR amount: e.g., "1,000 QAR"
- ✓ EGP amount: e.g., "→ 270 EGP" (using fx_rate)
- ✓ FX rate: e.g., "@ 0.2700"
- ✓ All formatting uses current language (EN/AR)

## 3. Dashboard Testing

### 3.1 Customer Dashboard Shows Orders (NOT Empty)

**Test Scenario**: Verify dashboard displays orders instead of empty state

**Steps**:
1. Navigate to `/c/home` (Customer Dashboard)
2. Scroll down to "Recent" section
3. If you have orders in the system, they should appear

**Expected Result**:
- ✓ Dashboard shows up to 5 recent orders
- ✓ Each order displays:
  - QAR amount
  - EGP delivered (calculated)
  - FX rate
  - Order status (Approved/Pending/Rejected)
  - Date only (no time)
- ✓ If no orders exist, shows: "No orders yet"

### 3.2 Dashboard Metrics Calculation

**Test Scenario**: Verify KPI cards show correct aggregates

**Steps**:
1. On Customer Dashboard, check these KPI sections:
   - "This month" volume (QAR)
   - "Last month" volume (QAR)
   - "This week" volume (QAR)
   - "Sent (QAR)" total
   - "Received (EGP)" total
   - "Avg FX" rate

**Expected Result**:
- ✓ "This month" = sum of all orders created in current month
- ✓ "Sent" = sum of all approved orders' QAR amounts
- ✓ "Received" = sum of all approved orders' (amount × fx_rate)
- ✓ "Avg FX" = total EGP ÷ total QAR

**Calculation Example**:
- Order 1: 1,000 QAR @ 0.27 = 270 EGP
- Order 2: 500 QAR @ 0.28 = 140 EGP
- Total: 1,500 QAR → 410 EGP
- Avg FX: 410 ÷ 1,500 = 0.2733

## 4. Order Workflow Testing

### 4.1 Create Order as Customer

**Test Scenario**: Customer creates order requiring merchant approval

**Steps**:
1. Log in as **Customer** account
2. Navigate to `/c/orders`
3. Click "New QAR → EGP Order" button
4. Fill in form:
   - Select Merchant connection
   - Enter Amount (e.g., 1,000 QAR)
   - FX Rate should auto-populate
   - Click "Create Order"

**Expected Result**:
- ✓ Order created successfully
- ✓ Status shows "Awaiting approval"
- ✓ Notification sent to merchant (see Section 5.1)
- ✓ Order appears in `/c/orders` list
- ✓ Order appears on Customer Dashboard recent section

### 4.2 Create Order as Merchant (for Customer)

**Test Scenario**: Merchant creates order requiring customer approval

**Steps**:
1. Log in as **Merchant** account
2. Navigate to customer's order view in `/trading/orders`
3. Find customer and create order for them
4. Fill form and click "Create Order"

**Expected Result**:
- ✓ Order created with status "Pending customer approval"
- ✓ Notification sent to customer (see Section 5.2)
- ✓ Order appears in merchant's order list
- ✓ Customer sees notification badge

### 4.3 Approve Order (Inline in Notification Center)

**Test Scenario**: Approve order directly from notification

**Steps**:
1. Log in as the account that needs to approve (opposite of who created it)
2. Click the **bell icon** in top nav bar (Notification Center)
3. Find the order notification
4. Click the **inline "Approve" button** in the notification
5. Optional: If prompted, confirm approval

**Expected Result**:
- ✓ Order status changes to "Approved"
- ✓ Counterpart receives approval notification immediately
- ✓ Notification is marked as read/resolved
- ✓ Order payment/settlement can proceed
- ✓ Both parties' order lists updated

### 4.4 Reject Order (Inline in Notification Center)

**Test Scenario**: Reject order with reason

**Steps**:
1. While testing, create another order
2. Open Notification Center (bell icon)
3. Click **inline "Reject" button**
4. If prompted, enter rejection reason (e.g., "Rate not acceptable")
5. Confirm

**Expected Result**:
- ✓ Order status changes to "Rejected"
- ✓ Rejection reason is recorded
- ✓ Counterpart receives rejection notification with reason
- ✓ Both parties see "Rejected" status in order lists
- ✓ Cannot re-approve rejected orders (would need new order)

### 4.5 Edit/Revise Approved Order

**Test Scenario**: Change an approved order (increments revision)

**Prerequisites**: An order in "Approved" status

**Steps**:
1. Open the approved order detail view
2. Click "Edit Order" or similar button
3. Change the amount or other details
4. Click "Save Changes"

**Expected Result**:
- ✓ Order status returns to "Awaiting [counterpart] approval"
- ✓ Revision number increments (e.g., 1 → 2)
- ✓ Counterpart receives "Order Updated" notification with revision #
- ✓ Original approval is cleared, requires re-approval
- ✓ Both parties see new revision in UI

## 5. Notification Center Testing

### 5.1 Notification Center Visible

**Test Scenario**: Bell icon appears in top navigation

**Steps**:
1. Navigate to any customer page
2. Look at the top-right header area
3. Should see a **bell icon** next to language selector

**Expected Result**:
- ✓ Bell icon is visible and clickable
- ✓ Bell shows unread count badge (if > 0)
- ✓ Clicking bell opens dropdown notification panel
- ✓ Bell icon is at position: `<CustomerActivityCenter />` component

### 5.2 Real-Time Notifications Arrive

**Test Scenario**: Verify notifications appear instantly

**Steps**:
1. Open two browser windows/tabs:
   - Tab A: Logged in as Customer
   - Tab B: Logged in as Merchant
2. In Tab B, create an order for the customer in Tab A
3. Check Tab A's Notification Center immediately

**Expected Result**:
- ✓ Notification appears in Tab A within 1-2 seconds
- ✓ Bell icon badge updates (e.g., "+1")
- ✓ Green "Live" indicator visible in notification panel (indicates real-time connection)
- ✓ Notification shows merchant name and order details

### 5.3 Category Filtering

**Test Scenario**: Filter notifications by category

**Steps**:
1. Open Notification Center (bell icon)
2. Click category tabs at the top:
   - "All" - should show all notifications
   - "Approvals" - should show order approval/rejection notifications
   - "Orders" - should show order-related notifications
   - "Messages" - should show chat messages
   - "System" - should show system notifications

**Expected Result**:
- ✓ Each category filters notifications correctly
- ✓ Count badges match filtered results
- ✓ "All" shows complete list
- ✓ Category switching is fast (< 200ms)

### 5.4 Inline Action Buttons

**Test Scenario**: Use quick action buttons in notifications

**Steps**:
1. In Notification Center, find an order notification that needs action
2. Look for inline buttons:
   - "Approve" button (green/primary color)
   - "Reject" button (red/destructive color)
3. Click "Approve" to approve the order instantly

**Expected Result**:
- ✓ Buttons appear on hover/focus
- ✓ Clicking "Approve" changes order status immediately
- ✓ Notification resolves/disappears or marks as handled
- ✓ Counterpart receives approval notification
- ✓ No page refresh needed

### 5.5 Mark All as Read

**Test Scenario**: Bulk mark all notifications as read

**Steps**:
1. Open Notification Center with multiple unread notifications
2. Look for "Mark all as read" button
3. Click it

**Expected Result**:
- ✓ All notification badges clear
- ✓ Notifications remain in list but appear as "read"
- ✓ Bell icon badge becomes "0" or hides

### 5.6 Navigate to Order from Notification

**Test Scenario**: Click notification to view order details

**Steps**:
1. Open Notification Center
2. Click on a notification (anywhere except the action buttons)
3. Should navigate to the order detail page

**Expected Result**:
- ✓ Navigates to `/c/orders?id={orderId}`
- ✓ Order details page loads
- ✓ Notification center closes
- ✓ Order status and details match the notification

## 6. Mobile Responsiveness Testing

### 6.1 Order Cards Fit Mobile Screens

**Test Scenario**: Verify order cards are readable on mobile

**Steps**:
1. Open DevTools (F12)
2. Toggle Device Toolbar (mobile view)
3. Set viewport to:
   - iPhone 12 (390 × 844)
   - Or other mobile dimensions
4. Navigate to `/c/orders`
5. Scroll through order cards

**Expected Result**:
- ✓ Order cards display in single column on mobile
- ✓ All text is readable (not too small)
- ✓ Amounts and FX rate are visible
- ✓ Status badge fits on single line
- ✓ No horizontal scroll needed
- ✓ Padding/margins look balanced

**Specific Layout Check**:
- Desktop: `grid-cols-2` (2 columns)
- Mobile: `sm:grid-cols-1` (1 column, becomes 2 at larger screens)
- Font sizes: `text-xl sm:text-2xl` (responsive)
- Gap: `gap-2 sm:gap-3` (smaller gap on mobile)

### 6.2 Notification Center on Mobile

**Test Scenario**: Notification bell and dropdown work on mobile

**Steps**:
1. Mobile view (iPhone 12 width)
2. Click bell icon in top navigation
3. Notification dropdown should appear
4. Try scrolling through notifications

**Expected Result**:
- ✓ Bell icon is tappable (large enough for touch)
- ✓ Dropdown doesn't exceed screen width
- ✓ Scrollable list fits on screen
- ✓ Action buttons are easily tappable
- ✓ No layout overflow

### 6.3 Dashboard Responsive

**Test Scenario**: Dashboard KPI cards and sections fit mobile

**Steps**:
1. Mobile view
2. Navigate to `/c/home`
3. Check each section:
   - Hero/welcome section
   - KPI cards (volume)
   - FX summary
   - Trend chart
   - Recent orders

**Expected Result**:
- ✓ Hero section is readable
- ✓ KPI cards stack vertically on mobile
- ✓ FX summary shows all three columns (Sent, Received, Avg FX)
- ✓ Trend chart is compact but visible
- ✓ Recent orders display in single column
- ✓ No horizontal scrolling

## 7. Bilingual Testing (Arabic/English)

### 7.1 Language Switcher Works

**Test Scenario**: Toggle between English and Arabic

**Steps**:
1. Navigate to any page in customer portal
2. Find language selector (bottom-left of sidebar on desktop, or in header on mobile)
3. Click "EN" to ensure English, then "AR" to switch to Arabic

**Expected Result**:
- ✓ Language changes instantly
- ✓ All UI labels in correct language
- ✓ Layout switches to RTL (right-to-left) for Arabic
- ✓ Numbers and currencies display with correct separators

### 7.2 Arabic Translations Accuracy

**Test Scenario**: Verify key Arabic translations

**Check These Labels in Arabic (AR mode)**:
- Home = "الرئيسية"
- Orders = "الطلبات"
- Cash = "النقد"
- Chat = "المحادثات"
- Merchants = "التجار"
- Notifications = "التنبيهات"
- Settings = "الإعدادات"
- "Awaiting approval" = "بانتظار الموافقة"
- "Approved" = "مقبول"
- "Rejected" = "مرفوض"

**Expected Result**:
- ✓ All core labels properly translated
- ✓ No untranslated English text visible
- ✓ Formatting is correct (no missing punctuation)

### 7.3 RTL Layout Correct

**Test Scenario**: Verify layout mirrors correctly in Arabic

**Steps**:
1. Switch to Arabic (AR)
2. Check these elements:
   - Sidebar should be on right side (not left)
   - Navigation icons should be right-aligned
   - Text direction should be right-to-left
   - Back arrows should point left (for RTL)

**Expected Result**:
- ✓ All elements properly mirrored
- ✓ Readability is good
- ✓ Form fields align correctly for RTL

### 7.4 Number Formatting in Both Languages

**Test Scenario**: Numbers display with correct separators

**Check**:
- English: `1,234.56` (comma separator, dot decimal)
- Arabic: `١٬٢٣٤٫٥٦` (Arabic numerals, correct separators)

**Steps**:
1. In English mode, look at order amounts (should show Arabic numbers might be converted)
2. In Arabic mode, check amounts use Arabic numerals

**Expected Result**:
- ✓ English uses Western numerals: 1,000 QAR
- ✓ Arabic uses Arabic-Indic numerals: ١٬٠٠٠
- ✓ Decimal separators are correct for each language
- ✓ Currency symbol position is correct

## 8. Data Verification Queries

### 8.1 Verify Orders Created Correctly

In Supabase SQL Editor:
```sql
SELECT 
  id, merchant_id, customer_user_id, amount, 
  send_currency, receive_currency, fx_rate, 
  workflow_status, placed_by_role, created_at
FROM public.customer_orders 
ORDER BY created_at DESC 
LIMIT 10;
```

**Expected**:
- ✓ All orders have `workflow_status` (one of: pending_customer_approval, pending_merchant_approval, approved, rejected, cancelled)
- ✓ All orders have `fx_rate` populated (numeric value)
- ✓ `placed_by_role` is either 'merchant' or 'customer'
- ✓ `send_currency` and `receive_currency` are QAR and EGP

### 8.2 Verify Notifications Created Correctly

```sql
SELECT 
  id, user_id, category, title, body, 
  entity_type, entity_id, read_at, created_at
FROM public.notifications 
WHERE category = 'customer_order'
ORDER BY created_at DESC 
LIMIT 20;
```

**Expected**:
- ✓ Notification created for every order placement
- ✓ Notifications created for approvals/rejections
- ✓ `target_path` points to correct page (/customer/orders or /trading/orders)
- ✓ Title includes merchant/customer name
- ✓ Body shows amount and currency pair

### 8.3 Verify RLS Policies Enforced

In Supabase SQL Editor, test as customer:
```sql
-- Should return only this customer's orders
SELECT COUNT(*) FROM public.customer_orders 
WHERE customer_user_id = auth.uid();
```

**Expected**:
- ✓ Returns only orders where customer_user_id = current user
- ✓ Cannot see merchant's orders from other customers
- ✓ Cannot see other users' cash accounts

## 9. Full End-to-End Workflow Test

**Complete Test Scenario**: Full order lifecycle

**Steps**:
1. Customer creates order → Merchant receives notification
2. Merchant approves inline → Customer gets notification
3. Order marked approved → Both see updated status
4. Customer edits order → Revision increments
5. Merchant approves revision → Order ready to settle

**Expected Result**:
- ✓ All steps complete without errors
- ✓ All notifications arrive in real-time
- ✓ UI reflects all status changes immediately
- ✓ Data in Supabase matches UI state
- ✓ No stale data or inconsistencies

## 10. Deployment Checklist

Before deploying to production:

- [ ] All TypeScript checks pass: `npm run typecheck`
- [ ] All build checks pass: `npm run build:preflight`
- [ ] All migrations applied to database
- [ ] Edge Function `fetch-fx-rate` deployed
- [ ] RLS policies verified active
- [ ] FX Rate API tested (INSTAPAY V1 endpoint)
- [ ] Dashboard shows orders (not empty)
- [ ] Notification center visible and working
- [ ] Inline approve/reject actions work
- [ ] Real-time notifications tested (green "Live" indicator)
- [ ] Mobile layout verified responsive
- [ ] Arabic/English bilingual tested
- [ ] Test orders created and workflow completed end-to-end
- [ ] No console errors in browser DevTools
- [ ] Supabase database logs show no RLS violations
- [ ] Edge Function logs show successful API calls

---

**Last Updated**: 2024-04-23
**Test Coverage**: 80+ test cases across 10 major areas
**Estimated Time to Complete**: 45-60 minutes for full testing
