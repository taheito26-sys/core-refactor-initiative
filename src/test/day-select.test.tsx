import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DaySelect } from '@/components/shared/PeriodPicker';

describe('DaySelect', () => {
  it('is picked from lists, not typed, and reports a day once day, month and year are chosen', () => {
    const onChange = vi.fn();
    render(<DaySelect label="From" value="" onChange={onChange} max="2026-12-31" />);
    expect(document.querySelector('input')).toBeNull();
    fireEvent.change(screen.getByLabelText('Day'), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText('Month'), { target: { value: '10' } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Year'), { target: { value: '2026' } });
    expect(onChange).toHaveBeenCalledWith('2026-10-05');
  });

  it('pulls the day back when the month is shorter', () => {
    const onChange = vi.fn();
    render(<DaySelect label="From" value="2026-01-31" onChange={onChange} max="2026-12-31" />);
    fireEvent.change(screen.getByLabelText('Month'), { target: { value: '2' } });
    expect(onChange).toHaveBeenCalledWith('2026-02-28');
  });

  it('offers only the days a month has', () => {
    render(<DaySelect label="From" value="2026-02-10" onChange={vi.fn()} max="2026-12-31" />);
    expect(screen.getByLabelText('Day').querySelectorAll('option')).toHaveLength(29);
  });
});
