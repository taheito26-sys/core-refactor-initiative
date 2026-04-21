export function resolveCustomerLabel(params: {
  displayName?: string | null;
  name?: string | null;
  nickname?: string | null;
  phone?: string | null;
  customerUserId: string;
}): string {
  const candidates = [
    params.displayName,
    params.name,
    params.nickname,
    params.phone,
  ];

  for (const candidate of candidates) {
    const label = candidate?.trim();
    if (label) return label;
  }

  // Fall back to a shortened UUID rather than the full raw ID
  const uid = params.customerUserId?.trim();
  if (!uid) return 'Customer';
  // If it looks like a UUID, show first 8 chars prefixed with #
  if (/^[0-9a-f]{8}-/i.test(uid)) return `Client #${uid.slice(0, 8).toUpperCase()}`;
  return uid;
}

export function resolveCustomerDisplayName(
  profile?: { display_name?: string | null; name?: string | null; phone?: string | null; user_id?: string | null } | null,
  connection?: { nickname?: string | null; customer_user_id?: string | null } | null,
  fallbackLabel = 'Customer',
) {
  return resolveCustomerLabel({
    displayName: profile?.display_name,
    name: profile?.name,
    nickname: connection?.nickname,
    phone: profile?.phone,
    customerUserId: profile?.user_id ?? connection?.customer_user_id ?? fallbackLabel,
  });
}
