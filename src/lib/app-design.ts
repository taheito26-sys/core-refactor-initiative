// ─── Which design the merchant app is shown in ───
// 'v2' is the redesigned phone layout, 'classic' the original one, and 'taheito' the portal's card design with its
// four palettes on every merchant page. The choice lives in this browser; the theme code reads it without React.

export type AppDesign = 'v2' | 'classic' | 'taheito';

export const APP_DESIGN_KEY = 'home-design';
export const APP_DESIGN_EVENT = 'app-design-change';
export const DEFAULT_APP_DESIGN: AppDesign = 'v2';

export const isAppDesign = (value: unknown): value is AppDesign => value === 'v2' || value === 'classic' || value === 'taheito';

/** True for every design except Classic: the pages that ship a redesigned layout show it for both v2 and Taheito. */
export const usesNewLayout = (design: AppDesign): boolean => design !== 'classic';

/** The saved choice, with no side effects; safe to call from theme code and before React renders. */
export function readStoredDesign(): AppDesign {
  try {
    const saved = localStorage.getItem(APP_DESIGN_KEY);
    return isAppDesign(saved) ? saved : DEFAULT_APP_DESIGN;
  } catch {
    return DEFAULT_APP_DESIGN;
  }
}
