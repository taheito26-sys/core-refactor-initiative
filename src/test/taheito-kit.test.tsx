import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { Layers } from 'lucide-react';
import { ThBox, ThCard, ThChips, ThEmpty, ThHead, ThMain, ThRoot, ThSearch, ThSheet, ThTabs, ThTiles } from '@/features/taheito/kit';

afterEach(() => cleanup());

describe('Taheito kit', () => {
  it('draws the main card with one primary button, tabs, chips and tiles', () => {
    const onNew = vi.fn(); const onTab = vi.fn(); const onChip = vi.fn(); const onTile = vi.fn();
    render(
      <ThRoot lang="en">
        <ThMain label="Orders" primary={{ label: 'New sale', icon: null, onClick: onNew }}
          tabs={<ThTabs label="Orders" active="a" onSelect={onTab} tabs={[{ id: 'a', label: 'All' }, { id: 'b', label: 'Incoming', count: 3 }]} />}>
          <ThChips chips={[{ key: 'all', label: 'All months' }, { key: '2026-11', label: 'Nov', count: 5 }]} selected="all" onSelect={onChip} />
          <ThTiles tiles={[{ key: 'k', cls: 't1', icon: Layers, label: 'Orders', value: 12, on: true, onClick: onTile }]} />
        </ThMain>
      </ThRoot>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'New sale' })); expect(onNew).toHaveBeenCalledOnce();
    expect(screen.getByRole('tab', { name: 'All' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.click(screen.getByRole('tab', { name: /Incoming/ })); expect(onTab).toHaveBeenCalledWith('b');
    expect(screen.getByRole('tab', { name: /Incoming/ }).textContent).toContain('3');
    fireEvent.click(screen.getByRole('button', { name: /Nov/ })); expect(onChip).toHaveBeenCalledWith('2026-11');
    expect(screen.getByRole('button', { name: 'All months' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: /Orders/ })); expect(onTile).toHaveBeenCalled();
  });

  it('sets the page direction from the language', () => {
    const { container } = render(<ThRoot lang="ar"><span>x</span></ThRoot>);
    expect(container.firstElementChild?.getAttribute('dir')).toBe('rtl');
    expect(container.firstElementChild?.className).toContain('ch-root');
  });

  it('opens a card by click, Enter and Space, and carries its state in words and a stripe', () => {
    const onOpen = vi.fn();
    render(<ThCard stripe="prep" no="ORD-1" name="Hassan" date="11/16/2026" tag={{ label: 'Pending', tone: 'warn' }} goLabel="Details" onOpen={onOpen}
      columns={[{ k: 'Qty', v: '5,200', unit: 'USDT' }, { k: 'Net', v: '+572', tone: 'good', end: true }]} foot={<span>Manual</span>} />);
    const card = screen.getByRole('button', { name: /Hassan/ });
    expect(card.className).toContain('prep');
    expect(within(card).getByText('Pending')).toBeTruthy();
    fireEvent.click(card);
    fireEvent.keyDown(card, { key: 'Enter' });
    fireEvent.keyDown(card, { key: ' ' });
    expect(onOpen).toHaveBeenCalledTimes(3);
  });

  it('searches, shows a heading with its count, and an empty state in the same language', () => {
    const onChange = vi.fn(); const onAll = vi.fn();
    render(<>
      <ThSearch value="" onChange={onChange} placeholder="Search" label="Search orders" />
      <ThHead title="All orders" count={4} action={{ label: 'Show all', onClick: onAll }} />
      <ThEmpty icon={null} title="No orders" text="Add a sale"><button type="button">New</button></ThEmpty>
    </>);
    fireEvent.change(screen.getByLabelText('Search orders'), { target: { value: 'x' } }); expect(onChange).toHaveBeenCalledWith('x');
    expect(screen.getByText('(4)')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show all' })); expect(onAll).toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'No orders' })).toBeTruthy();
  });

  it('shows a record in a sheet with its header, tag and boxes, and closes it', () => {
    const onClose = vi.fn();
    render(<ThSheet open lang="en" onClose={onClose} title="ORD-1" tag={{ label: 'Due', tone: 'warn' }} subtitle="Hassan · today"><ThBox title="Details">body</ThBox></ThSheet>);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getAllByText('ORD-1').length).toBeGreaterThan(0);
    expect(within(dialog).getByText('Due')).toBeTruthy();
    expect(within(dialog).getByText('Details')).toBeTruthy();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
