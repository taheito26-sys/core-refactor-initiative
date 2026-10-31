/** Fiat per USDT from the fiat total received, e.g. 167,100 EGP for 3,000 USDT is 55.7. */
export function priceFromTotal(total: number, amount: number): number | null {
  if (!Number.isFinite(total) || !Number.isFinite(amount) || total <= 0 || amount <= 0) return null;
  return Number((total / amount).toFixed(8));
}

/** Fiat total for a price per USDT, to two decimals as the fiat is paid. */
export function totalFromPrice(price: number, amount: number): number | null {
  if (!Number.isFinite(price) || !Number.isFinite(amount) || price <= 0 || amount <= 0) return null;
  return Number((price * amount).toFixed(2));
}
