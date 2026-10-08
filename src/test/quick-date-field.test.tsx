import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QuickDateField, fromDayString, toDayString } from '@/components/shared/QuickDateField';

describe('day string helpers', () => {
  it('round-trips a local calendar day', () => {
    expect(toDayString(new Date(2026, 9, 4))).toBe('2026-10-04');
    expect(fromDayString('2026-10-04')?.getDate()).toBe(4);
    expect(fromDayString('not a date')).toBeUndefined();
  });
});

describe('QuickDateField', () => {
  it('sets today or yesterday with one tap and marks the chosen one', () => {
    const onChange = vi.fn();
    const today = new Date();
    const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
    render(<QuickDateField value={toDayString(today)} onChange={onChange} />);
    expect(screen.getByText('Today').className).toContain('border-primary');
    fireEvent.click(screen.getByText('Yesterday'));
    expect(onChange).toHaveBeenCalledWith(toDayString(yesterday));
  });

  it('speaks Arabic and offers a calendar for any other day', () => {
    render(<QuickDateField value="" onChange={vi.fn()} lang="ar" />);
    expect(screen.getByText('اليوم')).toBeTruthy();
    expect(screen.getByText('أمس')).toBeTruthy();
    expect(screen.getByText('اختر تاريخًا')).toBeTruthy();
  });

  it('clears the filter when the chosen shortcut is tapped again', () => {
    const onChange = vi.fn();
    render(<QuickDateField value={toDayString(new Date())} onChange={onChange} allowClear compact />);
    fireEvent.click(screen.getByText('Today'));
    expect(onChange).toHaveBeenCalledWith('');
    fireEvent.click(screen.getByLabelText('Clear date'));
    expect(onChange).toHaveBeenCalledTimes(2);
  });
});
