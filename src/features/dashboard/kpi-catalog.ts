// ─── Dashboard KPI catalog: the boxes a user can pin ───

export interface KpiOption {
  id: string;
  group: string;
  label: string;
  value: string;
  sub?: string;
  /** True for figures worth highlighting when above zero. */
  strong?: boolean;
}

export interface WatchedKpiSource {
  userNo: string;
  /** The name to show: the user's own, else Binance's nickname. */
  nick: string;
  /** The nickname Binance shows, kept when the user renames the merchant. */
  binanceNick?: string;
  /** Other names the merchant goes by. */
  aka?: string[];
  today: number | null;
  soldToday: number | null;
  total: number | null;
  month: number | null;
  /** Short text such as "Online now" or "3 h ago", and the exact Qatar time behind it. */
  lastOnline?: string | null;
  lastOnlineExact?: string | null;
  online?: boolean;
}

/** One box per figure of every followed merchant, ids stay stable across renames. */
export function merchantKpiOptions(sources: WatchedKpiSource[], group: string): KpiOption[] {
  const fmt = (n: number | null) => (n == null ? '—' : n.toLocaleString('en-US'));
  return sources.flatMap(s => [
    { id: `merchant:${s.userNo}:today`, group, label: `${s.nick} · today`, value: s.today == null ? '—' : `+${s.today}`, sub: 'orders today', strong: (s.today ?? 0) > 0 },
    { id: `merchant:${s.userNo}:sold`, group, label: `${s.nick} · sold today`, value: s.soldToday == null ? '—' : `+${s.soldToday}`, sub: 'sell orders today', strong: (s.soldToday ?? 0) > 0 },
    { id: `merchant:${s.userNo}:total`, group, label: `${s.nick} · total`, value: fmt(s.total), sub: 'all-time orders' },
    { id: `merchant:${s.userNo}:month`, group, label: `${s.nick} · 30 days`, value: fmt(s.month), sub: 'orders in 30 days' },
    { id: `merchant:${s.userNo}:seen`, group, label: `${s.nick} · last online`, value: s.lastOnline ?? '—', sub: s.lastOnlineExact ?? undefined, strong: !!s.online },
    {
      id: `merchant:${s.userNo}:name`, group, label: `${s.nick} · name`, value: s.nick,
      sub: [s.binanceNick && s.binanceNick !== s.nick ? `Binance: ${s.binanceNick}` : '', ...(s.aka ?? [])].filter(Boolean).join(' · ') || undefined,
    },
  ]);
}

/** Keeps the saved order, drops ids that no longer exist (an unfollowed merchant). */
export function resolvePinned(pinned: string[], options: KpiOption[]): KpiOption[] {
  const byId = new Map(options.map(o => [o.id, o]));
  return pinned.map(id => byId.get(id)).filter((o): o is KpiOption => !!o);
}

export function togglePinned(pinned: string[], id: string): string[] {
  return pinned.includes(id) ? pinned.filter(p => p !== id) : [...pinned, id];
}

/** First-time default: the first followed merchant's daily count, so the box is there without a visit to the picker. */
export function defaultPinned(sources: WatchedKpiSource[]): string[] {
  const first = sources[0];
  return first ? [`merchant:${first.userNo}:today`] : [];
}
