/**
 * Local-month bounds for a "YYYY-MM" key, matching the same local-calendar
 * math OrdersPage uses to bucket trades into month pills (`getFullYear()` /
 * `getMonth()`, not UTC), so a synced order lands in the month the user
 * actually clicked.
 */
export function monthKeyToRange(monthKey: string): { startTimestamp: number; endTimestamp: number } {
  const [year, month] = monthKey.split('-').map(Number);
  const start = new Date(year, month - 1, 1, 0, 0, 0, 0);
  const end = new Date(year, month, 1, 0, 0, 0, 0);
  return { startTimestamp: start.getTime(), endTimestamp: end.getTime() - 1 };
}
