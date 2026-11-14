import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const names: string[] = [];
vi.mock('@/features/auth/auth-context', () => ({ useAuth: () => ({ userId: 'u1' }) }));
vi.mock('@/features/shipments/api', () => ({ listShipments: async () => [] }));
vi.mock('@/integrations/supabase/client', () => {
  const make = (name: string) => {
    const ch: Record<string, unknown> = {};
    ch.on = () => ch;
    ch.subscribe = () => ch;
    names.push(name);
    return ch;
  };
  return { supabase: { channel: make, removeChannel: vi.fn() } };
});
import { useShipments } from '@/features/shipments/hooks';

function Watcher() { useShipments(); return null; }

describe('shipment realtime', () => {
  it('gives every component that watches shipments its own channel, so a second one cannot crash the page', () => {
    render(<QueryClientProvider client={new QueryClient()}><Watcher /><Watcher /></QueryClientProvider>);
    expect(names.length).toBe(2);
    expect(new Set(names).size).toBe(2);
  });
});
