import { supabase } from '@/integrations/supabase/client';

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
  return `${sendCountry} → ${receiveCountry}`;
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
    status: 'pending',
  };
}

export function getCustomerOrderSentAmount(order: Partial<CustomerOrderRow>) {
  return Number(order.amount ?? 0);
}

export function getCustomerOrderReceivedAmount(order: Partial<CustomerOrderRow>) {
  const total = Number(order.total ?? 0);
  if (Number.isFinite(total) && total > 0) return total;
  return Number(order.amount ?? 0);
}

export function deriveCustomerOrderMeta(order: Partial<CustomerOrderRow>, fallbackCountry?: string | null) {
  const sendCountry = order.send_country ?? fallbackCountry ?? 'Qatar';
  const receiveCountry = order.receive_country ?? (order.receive_currency === 'EGP' ? 'Egypt' : sendCountry);
  const sendCurrency = order.send_currency ?? order.currency ?? getCurrencyForCountry(sendCountry);
  const receiveCurrency = order.receive_currency ?? (order.total && order.total > 0 ? getCurrencyForCountry(receiveCountry) : sendCurrency);
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
    .select('id, customer_user_id, merchant_id, connection_id, order_type, amount, currency, rate, total, status, note, created_at, updated_at, confirmed_at, expires_at, payment_proof_url, payment_proof_uploaded_at, send_country, receive_country, send_currency, receive_currency, payout_rail, corridor_label')
    .eq('customer_user_id', userId)
    .order('created_at', { ascending: false });
}

export async function getCustomerOrder(orderId: string) {
  return supabase
    .from('customer_orders')
    .select('id, customer_user_id, merchant_id, connection_id, order_type, amount, currency, rate, total, status, note, created_at, updated_at, confirmed_at, expires_at, payment_proof_url, payment_proof_uploaded_at, send_country, receive_country, send_currency, receive_currency, payout_rail, corridor_label')
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
  return supabase.from('customer_profiles').insert(payload);
}

export async function updateCustomerProfile(userId: string, payload: Partial<CustomerProfileRow>) {
  return supabase.from('customer_profiles').update(payload).eq('user_id', userId);
}

export async function createCustomerOrder(input: CustomerOrderInput) {
  return supabase.from('customer_orders').insert(buildCustomerOrderPayload(input)).select('id').single();
}
