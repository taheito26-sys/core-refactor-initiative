import { describe, expect, it, vi } from 'vitest';
import { isolateScroll } from '@/components/shared/isolateScroll';

describe('isolateScroll', () => {
  it('keeps wheel and touchmove from reaching document-level scroll locks', () => {
    const atDocument = vi.fn();
    document.addEventListener('touchmove', atDocument);
    document.addEventListener('wheel', atDocument);
    const list = document.createElement('div');
    document.body.appendChild(list);
    isolateScroll(list);
    isolateScroll(list);
    list.dispatchEvent(new Event('touchmove', { bubbles: true }));
    list.dispatchEvent(new Event('wheel', { bubbles: true }));
    expect(atDocument).not.toHaveBeenCalled();
    document.body.dispatchEvent(new Event('touchmove', { bubbles: true }));
    expect(atDocument).toHaveBeenCalledTimes(1);
  });
});
