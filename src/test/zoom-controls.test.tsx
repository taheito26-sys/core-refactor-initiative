import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ZoomControls } from '@/components/shared/ZoomControls';
import { ZOOM_STORAGE_KEY } from '@/lib/app-zoom';

describe('ZoomControls', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.style.zoom = '';
  });

  it('steps the app-wide zoom in and out and remembers it', () => {
    render(<ZoomControls showPercent="always" />);
    expect(screen.getByText('100%')).toBeTruthy();
    fireEvent.click(screen.getByTitle('Zoom in'));
    expect(screen.getByText('110%')).toBeTruthy();
    expect(document.documentElement.style.zoom).toBe('1.1');
    expect(localStorage.getItem(ZOOM_STORAGE_KEY)).toBe('1.1');
    fireEvent.click(screen.getByTitle('Zoom out'));
    fireEvent.click(screen.getByTitle('Zoom out'));
    expect(screen.getByText('90%')).toBeTruthy();
  });
});
