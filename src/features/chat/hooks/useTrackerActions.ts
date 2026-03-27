import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { MOCK_OS_USER } from '@/lib/os-store';

export function useTrackerActions(roomId: string | null, relationshipId: string | null) {
  const [loading, setLoading] = useState(false);

  const createOrder = useCallback(async (amount: string, rate: string) => {
    setLoading(true);
    console.log(`[TrackerAPI] Creating order: ${amount} @ ${rate} for relationship ${relationshipId}`);
    
    // Mock simulation
    await new Promise(r => setTimeout(r, 1000));
    
    // In a real app, this would hit the 'orders' table
    // and potentially trigger a new secure room creation
    
    setLoading(false);
    return { ok: true, orderId: `ORD-${Math.floor(Math.random() * 9000) + 1000}` };
  }, [relationshipId]);

  const reserveStock = useCallback(async (amount: string) => {
    setLoading(true);
    console.log(`[TrackerAPI] Reserving stock: ${amount} for user ${MOCK_OS_USER.id}`);
    
    await new Promise(r => setTimeout(r, 800));
    
    setLoading(false);
    return { ok: true };
  }, []);

  const updateTags = useCallback(async (tags: string[]) => {
    setLoading(true);
    console.log(`[TrackerAPI] Updating merchant tags for room ${roomId}:`, tags);
    
    // Mock update: In real app, update 'os_rooms.tags' or 'os_users.tags'
    await new Promise(r => setTimeout(r, 500));
    
    setLoading(false);
    return { ok: true };
  }, [roomId]);

  return {
    createOrder,
    reserveStock,
    updateTags,
    loading
  };
}
