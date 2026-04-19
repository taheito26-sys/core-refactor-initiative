import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
import { getQatarEgyptGuideRate } from '@/features/customer/customer-market';

export const CUSTOMER_COUNTRIES = [
  'Qatar',
  'Egypt',
  'Saudi Arabia',
  'United Arab Emirates',
  'Kuwait',
  'Bahrain',
  'Oman',
] as const;

export type CustomerCountry = (typeof CUSTOMER_COUNTRIES)[number];

export const CUSTOMER_CURRENCY_BY_COUNTRY: Record<CustomerCountry, string> = {
  Qatar: 'QAR',
  Egypt: 'EGP',
  'Saudi Arabia': 'SAR',
  'United Arab Emirates': 'AED',
  Kuwait: 'KWD',
  Bahrain: 'BHD',
  Oman: 'OMR',
};

export const CUSTOMER_RAILS = [
  { value: 'bank_transfer', labelKey: 'bankTransfer', corridors: ['*'] as const },
  { value: 'cash_pickup', labelKey: 'cashPickup', corridors: ['Qatar->Egypt', 'Qatar->Saudi Arabia', 'United Arab Emirates->Egypt'] as const },
  { value: 'mobile_wallet', labelKey: 'mobileWallet', corridors: ['Qatar->Egypt', 'Egypt->Qatar', 'United Arab Emirates->Egypt'] as const },
  { value: 'instant_bank', labelKey: 'instantBank', corridors: ['*'] as const },
  { value: 'card_payout', labelKey: 'cardPayout', corridors: ['Qatar->Egypt', 'United Arab Emirates->Egypt'] as const },
] as const;

export type CustomerRail = (typeof CUSTOMER_RAILS)[number]['value'];

export type CustomerOrderStatus =
  | 'pending_quote'
  | 'quoted'
  | 'quote_accepted'
  | 'quote_rejected'
  | 'awaiting_payment'
  | 'payment_sent'
  | 'completed'
  | 'cancelled';

type LegacyCustomerOrderStatus = 'pending' | 'confirmed';

export type CustomerOrderRow = {
  id: string;
  customer_user_id: string;
  merchant_id: string;
  connection_id: string;
  order_type: string;
  amount: number;
  currency: string;
  rate: number | null;
  total: number | null;
  status: string;
  note: string | null;
  created_at: string;
  updated_at: string;
  confirmed_at: string | null;
  expires_at: string | null;
  payment_proof_url: string | null;
  payment_proof_uploaded_at: string | null;
  send_country: string | null;
  receive_country: string | null;
  send_currency: string | null;
  receive_currency: string | null;
  payout_rail: string | null;
  corridor_label: string | null;
  pricing_mode: string | null;
  guide_rate: number | null;
  guide_total: number | null;
  guide_source: string | null;
  guide_snapshot: Json | null;
  guide_generated_at: string | null;
  final_rate: number | null;
  final_total: number | null;
  final_quote_note: string | null;
  final_quote_expires_at: string | null;
  quoted_at: string | null;
  quoted_by_user_id: string | null;
  customer_accepted_quote_at: string | null;
  customer_rejected_quote_at: string | null;
  quote_rejection_reason: string | null;
  market_pair: string | null;
  pricing_version: string | null;
};

export type CustomerProfileRow = {
  id: string;
  user_id: string;
  display_name: string;
  phone: string | null;
  region: string | null;
  country: string | null;
  preferred_currency: string;
  status: string;
  created_at: string;
  updated_at: string;
};

export type CustomerNotificationRow = {
  id: string;
  title: string;
  body: string | null;
  category: string;
  read_at: string | null;
  created_at: string;
  target_path: string | null;
  target_tab: string | null;
  target_focus: string | null;
  target_entity_type: string | null;
  target_entity_id: string | null;
  dedupe_key: string | null;
};

export interface CustomerOrderInput {
  customerUserId: string;
  merchantId: string;
  connectionId: string;
  orderType: 'buy' | 'sell';
  amount: number;
  rate: number | null;
  note: string | null;
  sendCountry: CustomerCountry;
  receiveCountry: CustomerCountry;
  sendCurrency: string;
  receiveCurrency: string;
  payoutRail: string | null;
  corridorLabel: string;
}

export interface GuidePricingResult {
  pricingMode: 'merchant_quote';
  guideRate: number | null;
  guideTotal: number | null;
  guideSource: string | null;
  guideSnapshot: Json | null;
  guideGeneratedAt: string | null;
  marketPair: string | null;
  pricingVersion: string | null;
}

const ORDER_SELECT = [
  'id',
  'customer_user_id',
  'merchant_id',
  'connection_id',
  'order_type',
  'amount',
  'currency',
  'rate',
  'total',
  'status',
  'note',
  'created_at',
  'updated_at',
  'confirmed_at',
  'expires_at',
  'payment_proof_url',
  'payment_proof_uploaded_at',
  'send_country',
  'receive_country',
  'send_currency',
  'receive_currency',
  'payout_rail',
  'corridor_label',
  'pricing_mode',
  'guide_rate',
  'guide_total',
  'guide_source',
  'guide_snapshot',
  'guide_generated_at',
  'final_rate',
  'final_total',
  'final_quote_note',
  'final_quote_expires_at',
  'quoted_at',
  'quoted_by_user_id',
  'customer_accepted_quote_at',
  'customer_rejected_quote_at',
  'quote_rejection_reason',
  'market_pair',
  'pricing_version',
].join(', ');

const PRICING_VERSION = 'quote-flow-v1';

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeStatus(status?: string | null): CustomerOrderStatus | LegacyCustomerOrderStatus | string {
  return status ?? 'pending_quote';
}

export function canMerchantQuoteOrder(status?: string | null) {
  const normalized = normalizeStatus(status);
  return normalized === 'pending_quote' || normalized === 'pending';
}

export function canCustomerRespondToQuote(status?: string | null) {
  return normalizeStatus(status) === 'quoted';
}

export function getCurrencyForCountry(country?: string | null) {
  const resolved = country && country in CUSTOMER_CURRENCY_BY_COUNTRY
    ? CUSTOMER_CURRENCY_BY_COUNTRY[country as CustomerCountry]
    : 'QAR';
  return resolved;
}

export function normalizeCountry(country?: string | null): CustomerCountry | null {
  if (!country) return null;
  return (CUSTOMER_COUNTRIES as readonly string[]).includes(country) ? (country as CustomerCountry) : null;
}

export function getCorridorLabel(sendCountry: string, receiveCountry: string) {
  return `${sendCountry} -> ${receiveCountry}`;
}

export function getCompatibleRails(sendCountry: string, receiveCountry: string) {
  const corridorKey = `${sendCountry}->${receiveCountry}`;
  return CUSTOMER_RAILS.filter((rail) => rail.corridors.includes('*') || rail.corridors.includes(corridorKey));
}

export function getPreferredRail(sendCountry: string, receiveCountry: string) {
  return getCompatibleRails(sendCountry, receiveCountry)[0]?.value ?? CUSTOMER_RAILS[0].value;
}

export function buildCustomerOrderPayload(input: CustomerOrderInput) {
  return {
    customer_user_id: input.customerUserId,
    merchant_id: input.merchantId,
    connection_id: input.connectionId,
    order_type: input.orderType,
    amount: input.amount,
    currency: input.sendCurrency,
    rate: input.rate,
    total: input.rate && Number.isFinite(input.rate) ? input.amount * input.rate : null,
    note: input.note,
    send_country: input.sendCountry,
    receive_country: input.receiveCountry,
    send_currency: input.sendCurrency,
    receive_currency: input.receiveCurrency,
    payout_rail: input.payoutRail,
    corridor_label: input.corridorLabel,
    pricing_mode: 'merchant_quote',
    status: 'pending',
    pricing_version: PRICING_VERSION,
  };
}

export function getDisplayedCustomerRate(order: Partial<CustomerOrderRow>) {
  const status = normalizeStatus(order.status);
  if (status === 'pending_quote') {
    return order.guide_rate ?? order.rate ?? null;
  }

  return order.final_rate ?? order.rate ?? order.guide_rate ?? null;
}

export function getDisplayedCustomerTotal(order: Partial<CustomerOrderRow>) {
  const status = normalizeStatus(order.status);
  if (status === 'pending_quote') {
    return order.guide_total ?? order.total ?? null;
  }

  return order.final_total ?? order.total ?? order.guide_total ?? null;
}

export function getCustomerOrderSentAmount(order: Partial<CustomerOrderRow>) {
  return Number(order.amount ?? 0);
}

export function getCustomerOrderReceivedAmount(order: Partial<CustomerOrderRow>) {
  const total = Number(getDisplayedCustomerTotal(order) ?? 0);
  if (Number.isFinite(total) && total > 0) return total;
  return Number(order.amount ?? 0);
}

export function deriveCustomerOrderMeta(order: Partial<CustomerOrderRow>, fallbackCountry?: string | null) {
  const sendCountry = order.send_country ?? fallbackCountry ?? 'Qatar';
  const receiveCountry = order.receive_country ?? (order.receive_currency === 'EGP' ? 'Egypt' : sendCountry);
  const sendCurrency = order.send_currency ?? order.currency ?? getCurrencyForCountry(sendCountry);
  const receiveCurrency = order.receive_currency ?? getCurrencyForCountry(receiveCountry);
  const corridorLabel = order.corridor_label ?? getCorridorLabel(sendCountry, receiveCountry);
  return {
    sendCountry,
    receiveCountry,
    sendCurrency,
    receiveCurrency,
    corridorLabel,
  };
}

export function formatCustomerNumber(value: number, language: 'en' | 'ar' = 'en', digits = 2) {
  if (!Number.isFinite(value)) return '—';
  return new Intl.NumberFormat(language === 'ar' ? 'ar-EG' : 'en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

export function formatCustomerDate(value: string | Date, language: 'en' | 'ar' = 'en') {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat(language === 'ar' ? 'ar-EG' : 'en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

async function getMerchantUserId(merchantId: string) {
  const { data } = await supabase
    .from('merchant_profiles')
    .select('user_id, display_name, merchant_id')
    .eq('merchant_id', merchantId)
    .maybeSingle();
  return (data?.user_id ?? null) as string | null;
}

async function getCurrentOrderById(orderId: string) {
  const { data, error } = await supabase
    .from('customer_orders')
    .select(ORDER_SELECT)
    .eq('id', orderId)
    .maybeSingle();
  return { data: data as CustomerOrderRow | null, error };
}

async function insertCustomerOrderEvent(orderId: string, actorUserId: string, eventType: string, metadata: Json) {
  return supabase.from('customer_order_events').insert({
    order_id: orderId,
    actor_user_id: actorUserId,
    event_type: eventType,
    metadata,
  });
}

async function insertCustomerNotification(payload: {
  userId: string;
  title: string;
  body: string | null;
  category: string;
  targetPath: string;
  targetEntityType: string;
  targetEntityId: string;
  actorId?: string | null;
}) {
  return supabase.from('notifications').insert({
    user_id: payload.userId,
    title: payload.title,
    body: payload.body,
    category: payload.category,
    actor_id: payload.actorId ?? null,
    target_path: payload.targetPath,
    target_entity_type: payload.targetEntityType,
    target_entity_id: payload.targetEntityId,
  });
}

function buildOrderEventMetadata(order: Partial<CustomerOrderRow>, extra?: Json) {
  return {
    guide_rate: order.guide_rate ?? null,
    guide_total: order.guide_total ?? null,
    guide_source: order.guide_source ?? null,
    final_rate: order.final_rate ?? null,
    final_total: order.final_total ?? null,
    send_amount: order.amount ?? null,
    send_currency: order.send_currency ?? order.currency ?? null,
    receive_currency: order.receive_currency ?? null,
    corridor_label: order.corridor_label ?? null,
    payout_rail: order.payout_rail ?? null,
    ...extra,
  } as Json;
}

export function buildGuidePricingSnapshot(input: CustomerOrderInput, pricing: GuidePricingResult | null) {
  if (!pricing) {
    return null;
  }

  return {
    pricing_mode: pricing.pricingMode,
    guide_rate: pricing.guideRate,
    guide_total: pricing.guideTotal,
    guide_source: pricing.guideSource,
    guide_generated_at: pricing.guideGeneratedAt,
    market_pair: pricing.marketPair,
    pricing_version: pricing.pricingVersion,
    corridor_label: input.corridorLabel,
    payout_rail: input.payoutRail,
    send_amount: input.amount,
    send_currency: input.sendCurrency,
    receive_currency: input.receiveCurrency,
    guide_snapshot: pricing.guideSnapshot,
  } as Json;
}

export async function getGuidePricingForCustomerOrder(input: CustomerOrderInput): Promise<GuidePricingResult> {
  const now = nowIso();

  if (input.orderType !== 'buy') {
    return {
      pricingMode: 'merchant_quote',
      guideRate: null,
      guideTotal: null,
      guideSource: null,
      guideSnapshot: null,
      guideGeneratedAt: null,
      marketPair: `${input.sendCurrency}/${input.receiveCurrency}`,
      pricingVersion: PRICING_VERSION,
    };
  }

  const qatarToEgypt = input.sendCountry === 'Qatar' && input.receiveCountry === 'Egypt';
  if (!qatarToEgypt) {
    return {
      pricingMode: 'merchant_quote',
      guideRate: null,
      guideTotal: null,
      guideSource: null,
      guideSnapshot: null,
      guideGeneratedAt: null,
      marketPair: `${input.sendCurrency}/${input.receiveCurrency}`,
      pricingVersion: PRICING_VERSION,
    };
  }

  const guide = await getQatarEgyptGuideRate();
  if (guide.rate == null) {
    return {
      pricingMode: 'merchant_quote',
      guideRate: null,
      guideTotal: null,
      guideSource: guide.source,
      guideSnapshot: guide.snapshot,
      guideGeneratedAt: guide.timestamp,
      marketPair: guide.marketPair,
      pricingVersion: PRICING_VERSION,
    };
  }

  return {
    pricingMode: 'merchant_quote',
    guideRate: guide.rate,
    guideTotal: Number((input.amount * guide.rate).toFixed(6)),
    guideSource: guide.source,
    guideSnapshot: {
      source: guide.source,
      market_pair: guide.marketPair,
      generated_at: guide.timestamp ?? now,
      guide_rate: guide.rate,
      guide_total: Number((input.amount * guide.rate).toFixed(6)),
      source_snapshot: guide.snapshot,
    } as Json,
    guideGeneratedAt: guide.timestamp ?? now,
    marketPair: guide.marketPair,
    pricingVersion: PRICING_VERSION,
  };
}

export async function createCustomerOrderWithGuide(input: CustomerOrderInput) {
  const [pricing, merchantUserId] = await Promise.all([
    getGuidePricingForCustomerOrder(input),
    getMerchantUserId(input.merchantId),
  ]);

  const guideSnapshot = buildGuidePricingSnapshot(input, pricing);
  const createdAt = nowIso();
  const payload = {
    customer_user_id: input.customerUserId,
    merchant_id: input.merchantId,
    connection_id: input.connectionId,
    order_type: input.orderType,
    amount: input.amount,
    currency: input.sendCurrency,
    rate: null,
    total: null,
    status: 'pending_quote',
    note: input.note,
    send_country: input.sendCountry,
    receive_country: input.receiveCountry,
    send_currency: input.sendCurrency,
    receive_currency: input.receiveCurrency,
    payout_rail: input.payoutRail,
    corridor_label: input.corridorLabel,
    pricing_mode: pricing.pricingMode,
    guide_rate: pricing.guideRate,
    guide_total: pricing.guideTotal,
    guide_source: pricing.guideSource,
    guide_snapshot: guideSnapshot,
    guide_generated_at: pricing.guideGeneratedAt ?? createdAt,
    final_rate: null,
    final_total: null,
    final_quote_note: null,
    final_quote_expires_at: null,
    quoted_at: null,
    quoted_by_user_id: null,
    customer_accepted_quote_at: null,
    customer_rejected_quote_at: null,
    quote_rejection_reason: null,
    market_pair: pricing.marketPair,
    pricing_version: pricing.pricingVersion,
  };

  const { data, error } = await supabase.from('customer_orders').insert(payload).select(ORDER_SELECT).single();
  if (error) return { data: null, error };

  const order = data as CustomerOrderRow;
  const eventMetadata = buildOrderEventMetadata(order, {
    event_type: 'customer_order_created',
    status: order.status,
  } as Json);

  await insertCustomerOrderEvent(order.id, input.customerUserId, 'customer_order_created', eventMetadata);
  await insertCustomerOrderEvent(order.id, input.customerUserId, 'guide_price_generated', eventMetadata);

  if (merchantUserId) {
    await insertCustomerNotification({
      userId: merchantUserId,
      title: 'New customer order request',
      body: `${input.corridorLabel} · ${input.amount} ${input.sendCurrency}`,
      category: 'customer_order',
      targetPath: '/merchants?tab=client-orders',
      targetEntityType: 'customer_order',
      targetEntityId: order.id,
      actorId: input.customerUserId,
    });
  }

  return { data: order, error: null };
}

export async function commitCustomerQuote(
  order: CustomerOrderRow,
  input: {
    merchantUserId: string;
    finalRate: number;
    finalTotal: number;
    finalQuoteNote: string | null;
    finalQuoteExpiresAt: string | null;
  },
) {
  if (!canMerchantQuoteOrder(order.status)) {
    return { data: null, error: new Error('Order is not ready for quoting') };
  }

  const updates = {
    status: 'quoted',
    rate: input.finalRate,
    total: input.finalTotal,
    final_rate: input.finalRate,
    final_total: input.finalTotal,
    final_quote_note: input.finalQuoteNote,
    final_quote_expires_at: input.finalQuoteExpiresAt,
    quoted_at: nowIso(),
    quoted_by_user_id: input.merchantUserId,
  };

  const { data, error } = await supabase
    .from('customer_orders')
    .update(updates)
    .eq('id', order.id)
    .select(ORDER_SELECT)
    .single();

  if (error) return { data: null, error };

  const updated = data as CustomerOrderRow;
  const eventMetadata = buildOrderEventMetadata(updated, {
    event_type: 'merchant_quote_committed',
  } as Json);

  await insertCustomerOrderEvent(updated.id, input.merchantUserId, 'merchant_quote_committed', eventMetadata);

  const customerNotificationBody = input.finalQuoteNote
    ? `${updated.corridor_label ?? updated.id} · ${input.finalRate} / ${input.finalTotal}`
    : `${updated.corridor_label ?? updated.id} · quote ready`;

  await insertCustomerNotification({
    userId: updated.customer_user_id,
    title: 'Merchant sent final quote',
    body: customerNotificationBody,
    category: 'customer_order_quote',
    targetPath: '/c/orders',
    targetEntityType: 'customer_order',
    targetEntityId: updated.id,
    actorId: input.merchantUserId,
  });

  return { data: updated, error: null };
}

export async function acceptCustomerQuote(order: CustomerOrderRow, customerUserId: string) {
  if (!canCustomerRespondToQuote(order.status)) {
    return { data: null, error: new Error('Order is not in quoted state') };
  }

  const { data, error } = await supabase
    .from('customer_orders')
    .update({
      status: 'quote_accepted',
      customer_accepted_quote_at: nowIso(),
      customer_rejected_quote_at: null,
      quote_rejection_reason: null,
    })
    .eq('id', order.id)
    .select(ORDER_SELECT)
    .single();

  if (error) return { data: null, error };

  const updated = data as CustomerOrderRow;
  const eventMetadata = buildOrderEventMetadata(updated, {
    event_type: 'customer_quote_accepted',
  } as Json);
  await insertCustomerOrderEvent(updated.id, customerUserId, 'customer_quote_accepted', eventMetadata);

  const merchantUserId = await getMerchantUserId(updated.merchant_id);
  if (merchantUserId) {
    await insertCustomerNotification({
      userId: merchantUserId,
      title: 'Customer responded to quote',
      body: updated.corridor_label ?? updated.id,
      category: 'customer_order_quote_response',
      targetPath: '/merchants?tab=client-orders',
      targetEntityType: 'customer_order',
      targetEntityId: updated.id,
      actorId: customerUserId,
    });
  }

  return { data: updated, error: null };
}

export async function rejectCustomerQuote(order: CustomerOrderRow, customerUserId: string, reason: string | null = null) {
  if (!canCustomerRespondToQuote(order.status)) {
    return { data: null, error: new Error('Order is not in quoted state') };
  }

  const { data, error } = await supabase
    .from('customer_orders')
    .update({
      status: 'quote_rejected',
      customer_rejected_quote_at: nowIso(),
      customer_accepted_quote_at: null,
      quote_rejection_reason: reason?.trim() || null,
    })
    .eq('id', order.id)
    .select(ORDER_SELECT)
    .single();

  if (error) return { data: null, error };

  const updated = data as CustomerOrderRow;
  const eventMetadata = buildOrderEventMetadata(updated, {
    event_type: 'customer_quote_rejected',
    quote_rejection_reason: reason?.trim() || null,
  } as Json);
  await insertCustomerOrderEvent(updated.id, customerUserId, 'customer_quote_rejected', eventMetadata);

  const merchantUserId = await getMerchantUserId(updated.merchant_id);
  if (merchantUserId) {
    await insertCustomerNotification({
      userId: merchantUserId,
      title: 'Customer responded to quote',
      body: reason?.trim() ? reason.trim() : (updated.corridor_label ?? updated.id),
      category: 'customer_order_quote_response',
      targetPath: '/merchants?tab=client-orders',
      targetEntityType: 'customer_order',
      targetEntityId: updated.id,
      actorId: customerUserId,
    });
  }

  return { data: updated, error: null };
}

export async function markCustomerOrderAwaitingPayment(order: CustomerOrderRow, merchantUserId: string) {
  if (normalizeStatus(order.status) !== 'quote_accepted') {
    return { data: null, error: new Error('Order is not quote accepted') };
  }

  const { data, error } = await supabase
    .from('customer_orders')
    .update({ status: 'awaiting_payment' })
    .eq('id', order.id)
    .select(ORDER_SELECT)
    .single();

  if (error) return { data: null, error };

  const updated = data as CustomerOrderRow;
  await insertCustomerOrderEvent(updated.id, merchantUserId, 'merchant_marked_awaiting_payment', buildOrderEventMetadata(updated, {
    event_type: 'merchant_marked_awaiting_payment',
  } as Json));
  return { data: updated, error: null };
}

export async function markCustomerOrderPaymentSent(order: CustomerOrderRow, customerUserId: string) {
  if (normalizeStatus(order.status) !== 'awaiting_payment') {
    return { data: null, error: new Error('Order is not awaiting payment') };
  }

  const { data, error } = await supabase
    .from('customer_orders')
    .update({
      status: 'payment_sent',
      payment_proof_uploaded_at: nowIso(),
    })
    .eq('id', order.id)
    .select(ORDER_SELECT)
    .single();

  if (error) return { data: null, error };

  const updated = data as CustomerOrderRow;
  await insertCustomerOrderEvent(updated.id, customerUserId, 'customer_marked_payment_sent', buildOrderEventMetadata(updated, {
    event_type: 'customer_marked_payment_sent',
  } as Json));
  return { data: updated, error: null };
}

export async function completeCustomerOrder(order: CustomerOrderRow, merchantUserId: string) {
  if (normalizeStatus(order.status) !== 'payment_sent') {
    return { data: null, error: new Error('Order is not payment sent') };
  }

  const { data, error } = await supabase
    .from('customer_orders')
    .update({ status: 'completed' })
    .eq('id', order.id)
    .select(ORDER_SELECT)
    .single();

  if (error) return { data: null, error };

  const updated = data as CustomerOrderRow;
  await insertCustomerOrderEvent(updated.id, merchantUserId, 'merchant_completed_order', buildOrderEventMetadata(updated, {
    event_type: 'merchant_completed_order',
  } as Json));
  return { data: updated, error: null };
}

export async function cancelCustomerOrder(order: CustomerOrderRow, actorUserId: string) {
  const allowed = ['pending_quote', 'quoted', 'payment_sent', 'pending'] as const;
  if (!allowed.includes(normalizeStatus(order.status) as typeof allowed[number])) {
    return { data: null, error: new Error('Order cannot be cancelled in its current state') };
  }

  const { data, error } = await supabase
    .from('customer_orders')
    .update({ status: 'cancelled' })
    .eq('id', order.id)
    .select(ORDER_SELECT)
    .single();

  if (error) return { data: null, error };

  const updated = data as CustomerOrderRow;
  await insertCustomerOrderEvent(updated.id, actorUserId, 'order_cancelled', buildOrderEventMetadata(updated, {
    event_type: 'order_cancelled',
  } as Json));
  return { data: updated, error: null };
}

export async function listCustomerProfiles(userId: string) {
  return supabase
    .from('customer_profiles')
    .select('id, user_id, display_name, phone, region, country, preferred_currency, status, created_at, updated_at')
    .eq('user_id', userId)
    .maybeSingle();
}

export async function listCustomerConnections(userId: string) {
  return supabase
    .from('customer_merchant_connections')
    .select('id, customer_user_id, merchant_id, status, nickname, is_preferred, created_at, updated_at')
    .eq('customer_user_id', userId)
    .order('created_at', { ascending: false });
}

export async function listCustomerOrders(userId: string) {
  return supabase
    .from('customer_orders')
    .select(ORDER_SELECT)
    .eq('customer_user_id', userId)
    .order('created_at', { ascending: false });
}

export async function getCustomerOrder(orderId: string) {
  return supabase
    .from('customer_orders')
    .select(ORDER_SELECT)
    .eq('id', orderId)
    .single();
}

export async function listCustomerNotifications(userId: string) {
  return supabase
    .from('notifications')
    .select('id, title, body, category, read_at, created_at, target_path, target_tab, target_focus, target_entity_type, target_entity_id, dedupe_key')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
}

export async function createCustomerProfile(payload: Omit<CustomerProfileRow, 'id' | 'created_at' | 'updated_at' | 'status'> & { status?: string }) {
  const insertProfile = async (nextPayload: typeof payload) => supabase.from('customer_profiles').insert(nextPayload);
  const primary = await insertProfile(payload);
  if (!primary.error) return primary;

  const message = primary.error.message.toLowerCase();
  const isCountrySchemaError = message.includes('country') && (message.includes('schema cache') || message.includes('column'));
  if (!isCountrySchemaError) return primary;

  const { country: _country, ...fallbackPayload } = payload as Record<string, unknown>;
  return insertProfile(fallbackPayload as typeof payload);
}

export async function updateCustomerProfile(userId: string, payload: Partial<CustomerProfileRow>) {
  const updateProfile = async (nextPayload: Partial<CustomerProfileRow> | Record<string, unknown>) =>
    supabase.from('customer_profiles').update(nextPayload).eq('user_id', userId);

  const primary = await updateProfile(payload);
  if (!primary.error) return primary;

  const message = primary.error.message.toLowerCase();
  const isCountrySchemaError = message.includes('country') && (message.includes('schema cache') || message.includes('column'));
  if (!isCountrySchemaError) return primary;

  const { country: _country, ...fallbackPayload } = payload as Record<string, unknown>;
  return updateProfile(fallbackPayload);
}

export async function createCustomerOrder(input: CustomerOrderInput) {
  return supabase.from('customer_orders').insert(buildCustomerOrderPayload(input)).select(ORDER_SELECT).single();
}
