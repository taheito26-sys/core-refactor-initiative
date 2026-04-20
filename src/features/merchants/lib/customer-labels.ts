export function resolveCustomerLabel(params: {
  displayName?: string | null;
  name?: string | null;
  nickname?: string | null;
  customerUserId: string;
}): string {
  const label =
    params.displayName ??
    params.name ??
    params.nickname ??
    params.customerUserId;

  return label.trim();
}

export function resolveCustomerDisplayName(
  profile?: { display_name?: string | null; name?: string | null; user_id?: string | null } | null,
  connection?: { nickname?: string | null; customer_user_id?: string | null } | null,
  fallbackLabel = 'Customer',
) {
  return resolveCustomerLabel({
    displayName: profile?.display_name,
    name: profile?.name,
    nickname: connection?.nickname,
    customerUserId: profile?.user_id ?? connection?.customer_user_id ?? fallbackLabel,
  });
}
