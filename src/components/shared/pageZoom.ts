/**
 * The app applies CSS zoom to the document root. Measurements from getBoundingClientRect
 * are in screen pixels, while `left`/`top`/`width` written on a fixed element are
 * multiplied by that zoom again, so anchored lists must divide it back out.
 */
export function pageZoom(): number {
  if (typeof document === 'undefined') return 1;
  const z = parseFloat(getComputedStyle(document.documentElement).zoom || '1');
  return Number.isFinite(z) && z > 0 ? z : 1;
}
