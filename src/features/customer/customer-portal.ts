import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
import { getQatarEgyptGuideRate } from '@/features/customer/customer-market';
import type { CashAccount } from '@/features/orders/shared-order-workflow';

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

export const CUSTOMER_COUNTRY_BY_CURRENCY: Record<string, CustomerCountry> = Object.entries(CUSTOMER_CURRENCY_BY_COUNTRY).reduce(
  (acc, [country, currency]) => {
    acc[currency] = country as CustomerCountry;
    return acc;
  },
  {} as Record<string, CustomerCountry>,
);

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
  merchant_cash_account_id?: string | null;
  merchant_cash_account_name?: string | null;
  customer_cash_account_id?: string | null;
  customer_cash_account_name?: string | null;
  send_country?: string | null;
  receive_country?: string | null;
  send_currency?: string | null;
  receive_currency?: string | null;
  payout_rail: string | null;
  corridor_label?: string | null;
  pricing_mode: string | null;
  guide_rate: number | null;
  guide_total: number | null;
  guide_source: string | null;
  guide_snapshot: Json | null;
  guide_generated_at: string | null;
  final_rate: number | null;
  final_total: number | null;
  final_quote_note: string | null;
  quoted_by_user_id: string | null;
  customer_accepted_quote_at?: string | null;
  customer_rejected_quote_at?: string | null;
  quote_rejection_reason?: string | null;
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
  merchantCashAccountId?: string | null;
  merchantCashAccountName?: string | null;
  customerCashAccountId?: string | null;
  customerCashAccountName?: string | null;
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

export const ORDER_SELECT_FIELDS = [
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
  'quoted_at',
  'quoted_by_user_id',
  'customer_accepted_quote_at',
  'customer_rejected_quote_at',
  'quote_rejection_reason',
  'merchant_cash_account_id',
  'merchant_cash_account_name',
  'customer_cash_account_id',
  'customer_cash_account_name',
  'market_pair',
  'pricing_version',
];

const ORDER_INSERT_SELECT = 'id';

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

function normalizeAccountType(accountType?: string | null) {
  return (accountType ?? '').trim().toLowerCase();
}

export function isCustomerCashAccountEligibleForOrder(
  order: Partial<CustomerOrderRow>,
  account: Pick<CashAccount, 'id' | 'currency' | 'status' | 'type'> & Record<string, unknown>,
) {
  if (!account?.id) return false;
  if ('user_id' in account && order.customer_user_id && account.user_id !== order.customer_user_id) return false;
  if (account.status !== 'active') return false;

  const accountType = normalizeAccountType(account.type as string | null);
  if (accountType === 'merchant_custody' || accountType === 'vault') return false;
  if ('is_merchant_account' in account && Boolean(account.is_merchant_account)) return false;

  const receiveCurrency = order.receive_currency ?? getCurrencyForCountry(order.receive_country);
  if (receiveCurrency && account.currency !== receiveCurrency) return false;

  const rail = (order.payout_rail ?? '').trim().toLowerCase();
  if (rail === 'mobile_wallet' || rail === 'cash_pickup') {
    return ['hand', 'cash', 'mobile_wallet', 'other'].includes(accountType);
  }

  if (rail === 'bank_transfer' || rail === 'instant_bank' || rail === 'card_payout') {
    return ['bank', 'hand', 'cash', 'other'].includes(accountType);
  }

  return true;
}

export function getEligibleCustomerCashAccountsForOrder(
  order: Partial<CustomerOrderRow>,
  accounts: Array<Pick<CashAccount, 'id' | 'currency' | 'status' | 'type'> & Record<string, unknown>>,
) {
  return accounts.filter((account) => isCustomerCashAccountEligibleForOrder(order, account));
}

export function getCustomerOrderDestinationCurrency(order: Partial<CustomerOrderRow>) {
  return order.receive_currency ?? getCurrencyForCountry(order.receive_country);
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
    merchant_cash_account_id: input.merchantCashAccountId ?? null,
    merchant_cash_account_name: input.merchantCashAccountName ?? null,
    customer_cash_account_id: input.customerCashAccountId ?? null,
    customer_cash_account_name: input.customerCashAccountName ?? null,
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

export function deriveFinalQuoteValues(amount: number, input: { finalRate?: number | null; finalTotal?: number | null }) {
  const numericAmount = Number(amount);
  const finalRate = toFiniteNumber(input.finalRate);
  const finalTotal = toFiniteNumber(input.finalTotal);

  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    return {
      finalRate,
      finalTotal,
    };
  }

  if (finalRate != null && finalTotal == null) {
    return {
      finalRate,
      finalTotal: Number((numericAmount * finalRate).toFixed(6)),
    };
  }

  if (finalTotal != null && finalRate == null) {
    return {
      finalRate: Number((finalTotal / numericAmount).toFixed(6)),
      finalTotal,
    };
  }

  return {
    finalRate,
    finalTotal,
  };
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
  const inferredSendCountry = order.send_currency ? CUSTOMER_COUNTRY_BY_CURRENCY[order.send_currency] : null;
  const inferredReceiveCountry = order.receive_currency ? CUSTOMER_COUNTRY_BY_CURRENCY[order.receive_currency] : null;
  const inferredCurrencyCountry = order.currency ? CUSTOMER_COUNTRY_BY_CURRENCY[order.currency] : null;
  const sendCountry = fallbackCountry ?? inferredSendCountry ?? inferredCurrencyCountry ?? 'Qatar';
  const receiveCountry = inferredReceiveCountry ?? (order.market_pair?.includes('/') ? CUSTOMER_COUNTRY_BY_CURRENCY[order.market_pair.split('/')[1]?.trim() ?? ''] : null) ?? sendCountry;
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
  const result = await runCustomerOrderQueryWithFallback((selectClause) =>
    supabase
      .from('customer_orders')
      .select(selectClause)
      .eq('id', orderId)
      .maybeSingle(),
  );

  return { data: result.data as CustomerOrderRow | null, error: result.error };
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
  const meta = deriveCustomerOrderMeta(order);

  return {
    guide_rate: order.guide_rate ?? null,
    guide_total: order.guide_total ?? null,
    guide_source: order.guide_source ?? null,
    final_rate: order.final_rate ?? null,
    final_total: order.final_total ?? null,
    send_amount: order.amount ?? null,
    send_currency: meta.sendCurrency,
    receive_currency: meta.receiveCurrency,
    corridor_label: meta.corridorLabel,
    payout_rail: order.payout_rail ?? null,
    ...extra,
  } as Json;
}

export function extractMissingCustomerOrderColumn(error: { message?: string } | null | undefined) {
  const message = error?.message ?? '';
  const patterns = [
    /could not find the '([^']+)' column of 'customer_orders' in the schema cache/i,
    /could not find the "([^"]+)" column of "customer_orders" in the schema cache/i,
    /column "([^"]+)" does not exist/i,
    /column '([^']+)' does not exist/i,
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match?.[1]) return match[1];
  }

  return null;
}

function removeCustomerOrderField(payload: Record<string, unknown>, field: string) {
  if (!(field in payload)) {
    return null;
  }

  const nextPayload = { ...payload };
  delete nextPayload[field];
  return nextPayload;
}

async function runCustomerOrderQueryWithFallback<T>(
  buildQuery: (selectClause: string) => Promise<{ data: T; error: { message?: string } | null }>,
  initialFields: string[] = [...ORDER_SELECT_FIELDS],
) {
  const remainingFields = [...initialFields];
  const attemptedFields = new Set<string>();

  while (remainingFields.length > 0) {
    const result = await buildQuery(remainingFields.join(', '));
    if (!result.error) {
      return result;
    }

    const missingColumn = extractMissingCustomerOrderColumn(result.error);
    if (!missingColumn || attemptedFields.has(missingColumn)) {
      return result;
    }

    const fieldIndex = remainingFields.indexOf(missingColumn);
    if (fieldIndex === -1) {
      return result;
    }

    attemptedFields.add(missingColumn);
    remainingFields.splice(fieldIndex, 1);
  }

  return buildQuery('id');
}

function buildCustomerOrderInsertPayload(input: CustomerOrderInput, pricing?: GuidePricingResult | null) {
  const basePayload = {
    customer_user_id: input.customerUserId,
    merchant_id: input.merchantId,
    connection_id: input.connectionId,
    order_type: input.orderType,
    amount: input.amount,
    currency: input.sendCurrency,
    rate: input.orderType === 'sell' ? input.rate : null,
    total: input.orderType === 'sell' && input.rate && Number.isFinite(input.rate) ? input.amount * input.rate : null,
    note: input.note,
    merchant_cash_account_id: input.merchantCashAccountId ?? null,
    merchant_cash_account_name: input.merchantCashAccountName ?? null,
    customer_cash_account_id: input.customerCashAccountId ?? null,
    customer_cash_account_name: input.customerCashAccountName ?? null,
  };

  if (!pricing) return basePayload;

  return {
    ...basePayload,
    pricing_mode: pricing.pricingMode,
    guide_rate: pricing.guideRate,
    guide_total: pricing.guideTotal,
    guide_source: pricing.guideSource,
    guide_snapshot: pricing.guideSnapshot,
    guide_generated_at: pricing.guideGeneratedAt,
    market_pair: pricing.marketPair,
    pricing_version: pricing.pricingVersion,
  };
}

export async function insertCustomerOrderWithFallback(payload: Record<string, unknown>) {
  let remainingPayload = { ...payload };
  const attemptedFields = new Set<string>();

  while (Object.keys(remainingPayload).length > 0) {
    const primary = await supabase.from('customer_orders').insert(remainingPayload).select(ORDER_INSERT_SELECT).single();
    if (!primary.error) return primary;

    const missingColumn = extractMissingCustomerOrderColumn(primary.error);
    if (!missingColumn || attemptedFields.has(missingColumn)) {
      return primary;
    }

    const nextPayload = removeCustomerOrderField(remainingPayload, missingColumn);
    if (!nextPayload) {
      return primary;
    }

    attemptedFields.add(missingColumn);
    remainingPayload = nextPayload;
  }

  return supabase.from('customer_orders').insert({}).select(ORDER_INSERT_SELECT).single();
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
    send_amount: input.amount,
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
    ...buildCustomerOrderPayload({
      customerUserId: input.customerUserId,
      merchantId: input.merchantId,
      connectionId: input.connectionId,
      orderType: input.orderType,
      amount: input.amount,
      rate: null,
      note: input.note,
      sendCountry: input.sendCountry,
      receiveCountry: input.receiveCountry,
    sendCurrency: input.sendCurrency,
    receiveCurrency: input.receiveCurrency,
    payoutRail: input.payoutRail,
    corridorLabel: input.corridorLabel,
    merchantCashAccountId: input.merchantCashAccountId,
    merchantCashAccountName: input.merchantCashAccountName,
    customerCashAccountId: input.customerCashAccountId,
    customerCashAccountName: input.customerCashAccountName,
  }),
    status: 'pending_quote',
    pricing_mode: pricing.pricingMode,
    guide_rate: pricing.guideRate,
    guide_total: pricing.guideTotal,
    guide_source: pricing.guideSource,
    guide_snapshot: guideSnapshot,
    guide_generated_at: pricing.guideGeneratedAt ?? createdAt,
    market_pair: pricing.marketPair,
    pricing_version: pricing.pricingVersion,
  };

  const { data, error } = await insertCustomerOrderWithFallback(payload);
  if (error) return { data: null, error };

  const order = data as CustomerOrderRow;
  const fullOrderResult = await getCustomerOrder(order.id);
  const fullOrder = (fullOrderResult.data ?? order) as CustomerOrderRow;
  const eventMetadata = buildOrderEventMetadata(order, {
    event_type: 'customer_order_created',
    status: order.status,
  } as Json);

  await insertCustomerOrderEvent(order.id, input.customerUserId, 'customer_order_created', eventMetadata);
  await insertCustomerOrderEvent(order.id, input.customerUserId, 'guide_price_generated', eventMetadata);

  if (false && merchantUserId) {
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

  return { data: fullOrder, error: null };
}

export async function commitCustomerQuote(
  order: CustomerOrderRow,
  input: {
    merchantUserId: string;
    finalRate: number;
    finalTotal: number;
    finalQuoteNote: string | null;
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
    quoted_at: nowIso(),
    quoted_by_user_id: input.merchantUserId,
  };

  const { data, error } = await runCustomerOrderQueryWithFallback((selectClause) =>
    supabase
      .from('customer_orders')
      .update(updates)
      .eq('id', order.id)
      .select(selectClause)
      .single(),
  );

  if (error) return { data: null, error };

  const updated = data as CustomerOrderRow;
  const eventMetadata = buildOrderEventMetadata(updated, {
    event_type: 'merchant_quote_committed',
  } as Json);

  await insertCustomerOrderEvent(updated.id, input.merchantUserId, 'merchant_quote_committed', eventMetadata);

  const customerNotificationBody = input.finalQuoteNote
    ? `${updated.corridor_label ?? updated.id} · ${input.finalRate} / ${input.finalTotal}`
    : `${updated.corridor_label ?? updated.id} · approval requested`;

  await insertCustomerNotification({
    userId: updated.customer_user_id,
    title: 'Merchant sent order for approval',
    body: customerNotificationBody,
    category: 'customer_order_quote',
    targetPath: '/c/orders',
    targetEntityType: 'customer_order',
    targetEntityId: updated.id,
    actorId: input.merchantUserId,
  });

  return { data: updated, error: null };
}

export async function reopenCustomerOrderForApproval(order: CustomerOrderRow, merchantUserId: string) {
  const { data, error } = await runCustomerOrderQueryWithFallback((selectClause) =>
    supabase
      .from('customer_orders')
      .update({
        status: 'pending_quote',
        quoted_by_user_id: merchantUserId,
        customer_accepted_quote_at: null,
        customer_rejected_quote_at: null,
        quote_rejection_reason: null,
      })
      .eq('id', order.id)
      .select(selectClause)
      .single(),
  );

  if (error) return { data: null, error };

  const updated = data as CustomerOrderRow;
  await insertCustomerOrderEvent(updated.id, merchantUserId, 'merchant_reopened_for_approval', buildOrderEventMetadata(updated, {
    event_type: 'merchant_reopened_for_approval',
  } as Json));

  return { data: updated, error: null };
}

export async function acceptCustomerQuote(order: CustomerOrderRow, customerUserId: string, customerCashAccountId: string) {
  if (!canCustomerRespondToQuote(order.status)) {
    return { data: null, error: new Error('Order is not in quoted state') };
  }

  if (order.customer_user_id !== customerUserId) {
    return { data: null, error: new Error('Customer not authorized for this order') };
  }

  if (!customerCashAccountId) {
    return { data: null, error: new Error('Destination cash account is required') };
  }

  const { data, error } = await supabase.rpc('accept_customer_order_request', {
    p_order_id: order.id,
    p_customer_cash_account_id: customerCashAccountId,
  });

  if (error) return { data: null, error };

  return { data: data as CustomerOrderRow, error: null };
}

export async function rejectCustomerQuote(order: CustomerOrderRow, customerUserId: string, reason: string | null = null) {
  if (!canCustomerRespondToQuote(order.status)) {
    return { data: null, error: new Error('Order is not in quoted state') };
  }

  const { data, error } = await runCustomerOrderQueryWithFallback((selectClause) =>
    supabase
      .from('customer_orders')
      .update({
        status: 'quote_rejected',
      })
      .eq('id', order.id)
      .select(selectClause)
      .single(),
  );

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
  return { data: null, error: new Error('The order flow no longer uses payment phases') };
}

export async function markCustomerOrderPaymentSent(order: CustomerOrderRow, customerUserId: string) {
  return { data: null, error: new Error('The order flow no longer uses payment phases') };
}

export async function completeCustomerOrder(order: CustomerOrderRow, merchantUserId: string) {
  return { data: null, error: new Error('The order flow no longer uses completion phases') };
}

export async function cancelCustomerOrder(order: CustomerOrderRow, actorUserId: string) {
  const allowed = ['pending_quote', 'quoted', 'pending'] as const;
  if (!allowed.includes(normalizeStatus(order.status) as typeof allowed[number])) {
    return { data: null, error: new Error('Order cannot be cancelled in its current state') };
  }

  const { data, error } = await runCustomerOrderQueryWithFallback((selectClause) =>
    supabase
      .from('customer_orders')
      .update({ status: 'cancelled' })
      .eq('id', order.id)
      .select(selectClause)
      .single(),
  );

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
  const { data: connections, error } = await supabase
    .from('customer_merchant_connections')
    .select('id, customer_user_id, merchant_id, status, nickname, is_preferred, created_at, updated_at')
    .eq('customer_user_id', userId)
    .order('created_at', { ascending: false });
  if (error || !connections || connections.length === 0) {
    return { data: connections ?? [], error };
  }

  const merchantIds = [...new Set(connections.map((connection) => connection.merchant_id))];
  const { data: merchants } = await supabase
    .from('merchant_profiles')
    .select('merchant_id, display_name, nickname, merchant_code, region')
    .in('merchant_id', merchantIds);
  const merchantMap = new Map((merchants ?? []).map((merchant: any) => [merchant.merchant_id, merchant]));

  return {
    data: connections.map((connection: any) => ({
      ...connection,
      merchant: merchantMap.get(connection.merchant_id) ?? null,
    })),
    error: null,
  };
}

export async function listCustomerOrders(userId: string) {
  return runCustomerOrderQueryWithFallback((selectClause) =>
    supabase
      .from('customer_orders')
      .select(selectClause)
      .eq('customer_user_id', userId)
      .order('created_at', { ascending: false }),
  );
}

export async function getCustomerOrder(orderId: string) {
  return runCustomerOrderQueryWithFallback((selectClause) =>
    supabase
      .from('customer_orders')
      .select(selectClause)
      .eq('id', orderId)
      .single(),
  );
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
  const payload = {
    ...buildCustomerOrderPayload(input),
    status: 'pending',
    pricing_mode: 'merchant_quote',
    pricing_version: PRICING_VERSION,
  };

  return insertCustomerOrderWithFallback(payload);
}
