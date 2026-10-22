// ─── Last answer of a query, kept on the device ───
// The customer portal paints from the last answer a query got and refreshes behind it, so a screen
// never opens on a spinner for data it already showed on the previous visit.

const storageKey = (key: string) => `ch:q:v1:${key}`;

function read<T>(key: string): { data: T; at: number } | undefined {
  try {
    const raw = localStorage.getItem(storageKey(key));
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as { data?: T; at?: number };
    return parsed.data !== undefined && typeof parsed.at === 'number' ? { data: parsed.data, at: parsed.at } : undefined;
  } catch {
    return undefined;
  }
}

function write(key: string, data: unknown) {
  try {
    localStorage.setItem(storageKey(key), JSON.stringify({ data, at: Date.now() }));
  } catch {
    // storage full or unavailable: the next visit just opens without the head start
  }
}

/**
 * Options to spread into useQuery: the stored answer seeds the query when it is created (the
 * functions run once, not on every render) and every fresh answer is stored for the next visit.
 */
export function persistedQuery<T>(key: string, userId: string | null | undefined, fetcher: () => Promise<T>) {
  const id = `${key}:${userId ?? ''}`;
  return {
    queryFn: async (): Promise<T> => {
      const data = await fetcher();
      if (userId) write(id, data);
      return data;
    },
    initialData: (): T | undefined => (userId ? read<T>(id)?.data : undefined),
    initialDataUpdatedAt: (): number | undefined => (userId ? read<T>(id)?.at : undefined),
  };
}
