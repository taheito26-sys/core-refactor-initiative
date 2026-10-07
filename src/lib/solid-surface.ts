import type { CSSProperties } from 'react';

/**
 * Floating surfaces (popovers, menus, select lists) must never let the page show through.
 * The theme background is the opaque base; the popover token is layered on top, so a
 * token that fails to resolve still leaves a solid colour behind it.
 */
export const solidSurfaceStyle: CSSProperties = {
  backgroundColor: 'var(--tracker-bg, hsl(var(--background)))',
  backgroundImage: 'linear-gradient(hsl(var(--popover)), hsl(var(--popover)))',
};
