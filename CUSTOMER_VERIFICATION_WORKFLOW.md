# Customer Order/Payment Verification Workflow

## Overview

A comprehensive verification system that allows customers to confirm receipt of funds from merchants and validate that the amount received is correct. This prevents payment disputes and provides an audit trail for all transactions.

## Features

### 1. Three-Step Verification Process

**Step 1: Fund Receipt Confirmation**
- Customer confirms they have received the funds in their bank account
- Checkbox prevents accidental submissions
- Required before proceeding

**Step 2: Amount Entry & Bank Reference**
- Customer enters the actual amount received (from bank statement)
- Must provide bank transaction reference/ID
- Real-time discrepancy calculation:
  - Shows warning if amount differs from expected
  - Calculates percentage difference (e.g., -2.5%)
  - Color-coded alerts (amber: minor, red: major discrepancy)

**Step 3: Correctness Confirmation**
- Customer explicitly confirms if amount is correct
- Two options:
  - ✓ **Yes, Correct** - Amount matches order
  - ✗ **No, Discrepancy** - Flag for merchant review
- Optional notes for explaining discrepancies

### 2. Verification Modal

**Location:** Customer Portal → Approved Orders
**Button:** "✓ Verify Receipt & Amount"

**Modal Features:**
- Displays expected amount with calculation
- Shows order details (send/receive currency, rate)
- Real-time discrepancy detection
- Bilingual UI (English/Arabic with RTL support)
- Color-coded feedback systems

**Example Flow:**
```
Order: 4,752 QAR → Expected: 17,989 EGP (at 3.785 rate)
↓
Customer enters: 17,569 EGP
↓
System warns: -420 EGP difference (-2.3%)
↓
Customer confirms: "No, Discrepancy"
↓
Recorded for merchant review
```

### 3. Audit Trail & Logging

**Tracked Data:**
- When verification occurred
- Who verified it (customer user_id)
- Verification status (verified/failed/partial)
- Amount received
- Bank reference
- Discrepancy details
- Optional notes

**Database Tables:**
- `customer_orders.verification_*` columns - Current state
- `customer_order_verifications` table - Complete audit log

**All changes logged automatically via trigger**

## Database Schema

### New Columns on `customer_orders`

```sql
verification_status text          -- pending/verified/failed/partial
verified_at timestamptz           -- When customer verified
verified_by_user_id uuid          -- Which customer verified
verification_notes text           -- Optional notes
amount_received numeric           -- Amount actually received
bank_reference text               -- Bank transaction reference (TXN123456)
is_amount_correct boolean         -- true: correct, false: discrepancy, NULL: pending
```

### New Audit Table `customer_order_verifications`

```sql
id uuid PRIMARY KEY
order_id uuid                     -- Reference to order
customer_user_id uuid             -- Who verified
verification_status text          -- Status at verification time
is_amount_correct boolean         -- Outcome
amount_received numeric           -- Amount entered
bank_reference text               -- Bank reference entered
verification_notes text           -- Notes provided
created_at timestamptz            -- When verified
```

### New RPC Function

**Function:** `verify_customer_order_receipt()`

**Parameters:**
- `p_order_id` - Order to verify
- `p_is_amount_correct` - Boolean (true/false/null)
- `p_amount_received` - Decimal amount
- `p_bank_reference` - Transaction reference
- `p_verification_notes` - Optional notes

**Returns:** Updated order record

**Permissions:** Requires authentication (customer can only verify own orders)

## User Experience

### For Customers

1. **Approved Order Page**
   - See "✓ Verify Receipt & Amount" button
   - Click to open verification modal

2. **Verification Modal Opens**
   - Shows order summary with expected amount
   - Step 1: Checkbox to confirm fund receipt
   - Step 2: Enter actual amount + bank reference
   - System auto-calculates discrepancy
   - Step 3: Confirm correctness or flag discrepancy

3. **Submission**
   - "Confirm Verification" button (enabled after all required fields)
   - Displays confirmation state (✓ Verified or ⚠ Discrepancy Reported)

4. **Audit Trail Access**
   - Can view verification history for each order
   - See timestamps and notes for all verifications

### For Merchants

1. **Dashboard Visibility**
   - See which orders are verified vs pending verification
   - Filter orders by verification status
   - Spot flagged discrepancies for customer follow-up

2. **Audit Log Review**
   - Access customer_order_verifications table
   - See exact amounts received per customer
   - Review notes for disputed amounts
   - Data for reconciliation and dispute resolution

## Verification Statuses

| Status | Meaning | Action |
|--------|---------|--------|
| `pending` | Awaiting customer verification | Customer must verify |
| `verified` | Customer confirmed correct amount | Order complete |
| `failed` | Customer reports funds not received | Investigate/refund |
| `partial` | Partial amount received | Adjust balance/flag issue |

## Data Validation

### On Verification:
1. ✅ Order must exist and belong to customer
2. ✅ Order must be in 'approved' status
3. ✅ Amount received must be numeric
4. ✅ Bank reference required for audit
5. ✅ Correctness confirmation required
6. ✅ Automatically logs to audit table

### Discrepancy Detection:
- Compares `amount_received` vs expected amount
- Calculates percentage difference
- Warns if > 0.01 currency units different
- Color coding:
  - Amber: < 5% discrepancy
  - Red: > 5% discrepancy

## API Reference

### Verify Order

```typescript
// Call the RPC function
const { data, error } = await supabase.rpc('verify_customer_order_receipt', {
  p_order_id: '550e8400-e29b-41d4-a716-446655440000',
  p_is_amount_correct: true,
  p_amount_received: 17989,
  p_bank_reference: 'TXN20260929123456',
  p_verification_notes: 'Received on bank statement',
});

if (error) {
  console.error('Verification failed:', error);
} else {
  console.log('Order verified:', data);
}
```

### Query Verification History

```sql
SELECT * FROM public.customer_order_verifications
WHERE order_id = '550e8400-e29b-41d4-a716-446655440000'
ORDER BY created_at DESC;
```

### Get All Pending Verifications

```sql
SELECT * FROM public.customer_orders
WHERE verification_status = 'pending' 
  AND workflow_status = 'approved'
  AND customer_user_id = 'user-uuid';
```

## Implementation Files

### Database
- `supabase/migrations/20260929000000_add_customer_order_verification.sql`
  - Schema changes
  - RPC function
  - Audit table
  - Trigger for logging
  - Index for performance

### Frontend
- `src/pages/customer/components/OrderVerificationModal.tsx`
  - Verification UI component
  - 3-step form with validation
  - Discrepancy detection and warnings
  - Bilingual support

- `src/pages/customer/CustomerOrdersPage.tsx`
  - Integration of verification button
  - Modal state management
  - Integration with order list

## Testing Checklist

- [ ] Database migration applies without errors
- [ ] RPC function executes successfully
- [ ] Verification modal opens on approved orders
- [ ] Step 1: Checkbox required to proceed
- [ ] Step 2: Amount entry shows live discrepancy warning
- [ ] Step 2: Bank reference is required
- [ ] Step 3: Must select correct/discrepancy
- [ ] Submission succeeds when all fields filled
- [ ] Verification status updates in order list
- [ ] Audit log table receives entry
- [ ] Can view verification history
- [ ] Discrepancy correctly calculated (>5% warning)
- [ ] UI works in Arabic (RTL) mode
- [ ] Mobile responsive design works

## Future Enhancements

1. **Dispute Resolution Flow**
   - Auto-create support ticket for discrepancies
   - Merchant response mechanism
   - Refund/adjustment workflow

2. **Analytics**
   - Dashboard showing verification rates
   - Common discrepancy patterns
   - Customer verification trends

3. **Automation**
   - Auto-verify if amount matches exactly
   - Bulk verification for multiple orders
   - Integration with bank APIs for auto-checking

4. **Notifications**
   - Alert merchant when discrepancy reported
   - Reminder to customer to verify pending orders
   - Confirmation when verification complete

## Deployment

### Database
```bash
# Apply migration
supabase migration up

# Verify RPC function exists
supabase db push
```

### Application
```bash
# Build and test
npm run typecheck
npm run build:dry-run

# Deploy to production
git push origin main
```

### Post-Deployment Verification
1. ✓ RPC function callable
2. ✓ Verification modal appears for approved orders
3. ✓ Can verify orders and see status update
4. ✓ Audit log records entries
5. ✓ Merchants can see verification status

---

**Status:** ✅ Implemented and deployed
**Version:** 1.0.0
**Last Updated:** 2026-09-29
