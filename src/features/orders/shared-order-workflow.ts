import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';

/**
 * Shared order workflow types and helpers for merchant↔customer approval flow.
 * This replaces the old quote/payment workflow with a simple approval-first model.
 */

// ── Types ──

export type WorkflowStatus =
  | 'pending_customer_approval'
  | 'pending_merchant_approval'
  | 'approved'
  | 'rejected'
  | 'cancelled';

export type ActorRole = 'merchant' | 'customer';
export type ApprovalAction = 'approve' | 'reject';

export interface WorkflowOrder {
  id: string;
  customer_user_id: string;
  merchant_id: string;
  connection_id: string;
  order_type: string;
  amount: number;
  currency: string;
  status: string;
  note: string | null;

  // Workflow fields
  workflow_status: WorkflowStatus | null;
  placed_by_role: ActorRole | null;
  placed_by_user_id: string | null;
  approval_required_from_role: ActorRole | null;
  approved_by_user_id: string | null;
  approved_at: string | null;
  rejected_by_user_id: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
  revision_no: number;
  edited_from_order_id: string | null;

  // Location fields
  send_country: string | null;
  receive_country: string | null;
  send_currency: string | null;
  receive_currency: string | null;
  payout_rail: string | null;
  corridor_label: string | null;

  created_at: string;
  updated_at: string;
}

export interface CashLink {
  id: string;
  order_id: string;
  owner_role: ActorRole;
  cash_account_id: string; // text, not uuid
  amount: number | null;
  currency: string | null;
  link_kind: 'send' | 'receive' | 'settlement' | 'reserve';
  created_at: string;
}

export interface CashAccount {
  id: string;
  user_id: string;
  name: string;
  currency: string;
  type: string;
  status: string;
  created_at: string;
  updated_at: string;
}

// ── Select fields for consistent queries ──

export const ORDER_SELECT_FIELDS = [
  'id',
  'customer_user_id',
  'merchant_id',
  'connection_id',
  'order_type',
  'amount',
  'currency',
  'status',
  'note',
  'workflow_status',
  'placed_by_role',
  'placed_by_user_id',
  'approval_required_from_role',
  'approved_by_user_id',
  'approved_at',
  'rejected_by_user_id',
  'rejected_at',
  'rejection_reason',
  'revision_no',
  'edited_from_order_id',
  'send_country',
  'receive_country',
  'send_currency',
  'receive_currency',
  'payout_rail',
  'corridor_label',
  'created_at',
  'updated_at',
] as const;

// ── RPC Wrappers ──

/**
 * Create a new shared order request.
 * - Merchant-placed orders require customer approval
 * - Customer-placed orders require merchant approval
 * - Cash account links are created atomically with the order
 */
export async function createSharedOrderRequest({
  connectionId,
  placedByRole,
  amount,
  orderType,
  sendCountry,
  receiveCountry,
  sendCurrency,
  receiveCurrency,
  payoutRail,
  note,
  merchantCashAccountId,
  customerCashAccountId,
}: {
  connectionId: string;
  placedByRole: ActorRole;
  amount: number;
  orderType: string;
  sendCountry: string;
  receiveCountry: string;
  sendCurrency: string;
  receiveCurrency: string;
  payoutRail: string;
  note?: string | null;
  merchantCashAccountId?: string | null; // text, not uuid
  customerCashAccountId?: string | null; // text, not uuid
}): Promise<WorkflowOrder> {
  const { data, error } = await supabase.rpc('create_customer_order_request', {
    p_connection_id: connectionId,
    p_placed_by_role: placedByRole,
    p_amount: amount,
    p_order_type: orderType,
    p_send_country: sendCountry,
    p_receive_country: receiveCountry,
    p_send_currency: sendCurrency,
    p_receive_currency: receiveCurrency,
    p_payout_rail: payoutRail,
    p_note: note ?? null,
    p_merchant_cash_account_id: merchantCashAccountId ?? null,
    p_customer_cash_account_id: customerCashAccountId ?? null,
  });

  if (error) throw error;
  return data as WorkflowOrder;
}

/**
 * Approve or reject an order request.
 * Only the required approver can call this.
 */
export async function respondSharedOrder({
  orderId,
  actorRole,
  action,
  reason,
}: {
  orderId: string;
  actorRole: ActorRole;
  action: ApprovalAction;
  reason?: string | null;
}): Promise<WorkflowOrder> {
  const { data, error } = await supabase.rpc('respond_customer_order_request', {
    p_order_id: orderId,
    p_actor_role: actorRole,
    p_action: action,
    p_reason: reason ?? null,
  });

  if (error) throw error;
  return data as WorkflowOrder;
}

/**
 * Edit an approved order.
 * - Increments revision number
 * - Resets workflow to counterpart approval
 * - Updates cash links atomically
 */
export async function editSharedOrder({
  orderId,
  actorRole,
  amount,
  note,
  merchantCashAccountId,
  customerCashAccountId,
}: {
  orderId: string;
  actorRole: ActorRole;
  amount?: number | null;
  note?: string | null;
  merchantCashAccountId?: string | null; // text, not uuid
  customerCashAccountId?: string | null; // text, not uuid
}): Promise<WorkflowOrder> {
  const { data, error } = await supabase.rpc('edit_customer_order_request', {
    p_order_id: orderId,
    p_actor_role: actorRole,
    p_amount: amount ?? null,
    p_note: note ?? null,
    p_merchant_cash_account_id: merchantCashAccountId ?? null,
    p_customer_cash_account_id: customerCashAccountId ?? null,
  });

  if (error) throw error;
  return data as WorkflowOrder;
}

// ── Query helpers ──

/**
 * List shared orders for the current actor (merchant or customer).
 */
export async function listSharedOrdersForActor(params: {
  merchantId?: string;
  customerUserId?: string;
}): Promise<WorkflowOrder[]> {
  let query = supabase
    .from('customer_orders')
    .select(ORDER_SELECT_FIELDS.join(', '));

  if (params.merchantId) {
    query = query.eq('merchant_id', params.merchantId);
  }
  if (params.customerUserId) {
    query = query.eq('customer_user_id', params.customerUserId);
  }

  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as WorkflowOrder[];
}

/**
 * Get a single order with its cash links.
 */
export async function getSharedOrderWithLinks(orderId: string): Promise<{
  order: WorkflowOrder;
  cashLinks: CashLink[];
}> {
  const [orderResult, linksResult] = await Promise.all([
    supabase
      .from('customer_orders')
      .select(ORDER_SELECT_FIELDS.join(', '))
      .eq('id', orderId)
      .single(),
    supabase
      .from('customer_order_cash_links')
      .select('*')
      .eq('order_id', orderId),
  ]);

  if (orderResult.error) throw orderResult.error;
  if (linksResult.error) throw linksResult.error;

  return {
    order: orderResult.data as WorkflowOrder,
    cashLinks: (linksResult.data ?? []) as CashLink[],
  };
}

/**
 * Get cash links for an order.
 */
export async function getCashLinksForOrder(orderId: string): Promise<CashLink[]> {
  const { data, error } = await supabase
    .from('customer_order_cash_links')
    .select('*')
    .eq('order_id', orderId);

  if (error) throw error;
  return (data ?? []) as CashLink[];
}

/**
 * Get cash accounts for a user.
 */
export async function getCashAccountsForUser(userId: string): Promise<CashAccount[]> {
  const { data, error } = await supabase
    .from('cash_accounts')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data ?? []) as CashAccount[];
}

// ── Workflow status helpers ──

export function getCounterpartRole(role: ActorRole): ActorRole {
  return role === 'merchant' ? 'customer' : 'merchant';
}

export function isAwaitingApproval(order: WorkflowOrder): boolean {
  return order.workflow_status === 'pending_customer_approval' ||
         order.workflow_status === 'pending_merchant_approval';
}

export function isAwaitingApprovalFrom(order: WorkflowOrder, role: ActorRole): boolean {
  return order.approval_required_from_role === role;
}

export function isApproved(order: WorkflowOrder): boolean {
  return order.workflow_status === 'approved';
}

export function isRejected(order: WorkflowOrder): boolean {
  return order.workflow_status === 'rejected';
}

export function isCancelled(order: WorkflowOrder): boolean {
  return order.workflow_status === 'cancelled';
}

export function isFinal(order: WorkflowOrder): boolean {
  return isApproved(order) || isRejected(order) || isCancelled(order);
}

/**
 * Get a human-readable status label.
 */
export function getWorkflowStatusLabel(status: WorkflowStatus | null): string {
  if (!status) return 'Unknown';

  const labels: Record<WorkflowStatus, string> = {
    pending_customer_approval: 'Awaiting Customer Approval',
    pending_merchant_approval: 'Awaiting Merchant Approval',
    approved: 'Approved',
    rejected: 'Rejected',
    cancelled: 'Cancelled',
  };

  return labels[status];
}

/**
 * Get who needs to approve next.
 */
export function getApprovalRequiredFrom(order: WorkflowOrder): ActorRole | null {
  return order.approval_required_from_role;
}

/**
 * Check if an actor can edit an order.
 */
export function canEditOrder(order: WorkflowOrder, role: ActorRole): boolean {
  if (isRejected(order) || isCancelled(order)) return false;
  if (role === 'merchant' && order.placed_by_role !== 'merchant') return false;
  if (role === 'customer' && order.placed_by_role !== 'customer') return false;
  return true;
}

/**
 * Check if an actor can approve an order.
 */
export function canApproveOrder(order: WorkflowOrder, role: ActorRole): boolean {
  return isAwaitingApprovalFrom(order, role);
}

/**
 * Check if an actor can reject an order.
 */
export function canRejectOrder(order: WorkflowOrder, role: ActorRole): boolean {
  return isAwaitingApprovalFrom(order, role);
}
