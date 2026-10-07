import { describe, expect, it } from 'vitest';
import { hexToHSL, isDark, toOpaqueHex } from '@/lib/theme/utils';

describe('theme colours', () => {
  it('reads rgba() glass-theme colours as opaque instead of producing NaN', () => {
    expect(toOpaqueHex('rgba(15,23,42,.7)')).toBe('#0f172a');
    expect(toOpaqueHex('#abc')).toBe('#abc');
    expect(hexToHSL('rgba(15,23,42,.7)')).toBe(hexToHSL('#0f172a'));
    expect(hexToHSL('rgba(15,23,42,.7)')).not.toMatch(/NaN/);
    expect(isDark('rgba(15,23,42,.7)')).toBe(true);
    expect(isDark('rgba(255,255,255,.7)')).toBe(false);
  });
});
