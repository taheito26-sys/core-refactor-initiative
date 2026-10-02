// ─── App-wide zoom ───
// Applies CSS zoom to the document root and publishes --app-zoom so viewport-height
// layouts can divide it back out (zoom multiplies 100vh/100dvh as well).

export const ZOOM_STORAGE_KEY = 'app-zoom-level';
export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 2;
export const ZOOM_STEP = 0.1;

const clampZoom = (z: number) =>
  Math.round(Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z)) * 100) / 100;

export function getStoredZoom(): number {
  try {
    const raw = localStorage.getItem(ZOOM_STORAGE_KEY);
    const n = raw ? parseFloat(raw) : 1;
    return Number.isFinite(n) ? clampZoom(n) : 1;
  } catch {
    return 1;
  }
}

export function applyZoom(zoom: number): number {
  const z = clampZoom(zoom);
  if (typeof document !== 'undefined') {
    const html = document.documentElement;
    html.style.zoom = String(z);
    html.style.setProperty('--app-zoom', String(z));
  }
  try {
    localStorage.setItem(ZOOM_STORAGE_KEY, String(z));
  } catch {
    // storage unavailable; zoom still applies for this session
  }
  return z;
}
