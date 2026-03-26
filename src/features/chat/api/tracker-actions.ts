import { supabase } from '@/integrations/supabase/client';
import { DeterministicResult, fail, ok } from '@/features/chat/lib/types';

async function currentUserId(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  const userId = data.user?.id;
  if (!userId) throw new Error('Not authenticated');
  return userId;
}

export async function createOrderDraftFromMessage(input: {
  roomId: string;
  messageId: string;
  relationshipId?: string | null;
  title: string;
  amount?: number;
  currency?: string;
}): Promise<DeterministicResult<{ dealId: string | null }>> {
  try {
    const userId = await currentUserId();
    if (!input.relationshipId) throw new Error('Room is not linked to a relationship');

    const { data: deal, error: dealError } = await supabase
      .from('merchant_deals' as any)
      .insert({
        relationship_id: input.relationshipId,
        title: input.title,
        amount: input.amount ?? 0,
        currency: input.currency ?? 'USDT',
        deal_type: 'general',
        status: 'pending',
        created_by: userId,
        notes: `source:chat|message_id:${input.messageId}`,
      })
      .select('id')
      .single();
    if (dealError) throw dealError;

    const { error: linkError } = await supabase.from('chat_tracker_links' as any).insert({
      room_id: input.roomId,
      message_id: input.messageId,
      link_type: 'order',
      linked_id: (deal as any).id,
      linked_path: '/trading/orders',
      merchant_relationship_id: input.relationshipId,
      created_by: userId,
      metadata: { prefill: { title: input.title, amount: input.amount ?? 0, currency: input.currency ?? 'USDT' } },
    });
    if (linkError) throw linkError;

    return ok({ dealId: (deal as any).id as string });
  } catch (error) {
    return fail({ dealId: null }, error);
  }
}

export async function createActionItemFromMessage(input: {
  roomId: string;
  messageId: string;
  kind: 'task' | 'reminder' | 'cash' | 'stock';
  title: string;
  payload?: Record<string, unknown>;
}): Promise<DeterministicResult<{ itemId: string | null }>> {
  try {
    const userId = await currentUserId();
    const { data: item, error: itemError } = await supabase
      .from('chat_action_items' as any)
      .insert({
        kind: input.kind,
        title: input.title,
        payload: input.payload ?? {},
        created_by: userId,
      })
      .select('id')
      .single();
    if (itemError) throw itemError;

    const { error: linkError } = await supabase.from('chat_tracker_links' as any).insert({
      room_id: input.roomId,
      message_id: input.messageId,
      link_type: input.kind,
      linked_id: (item as any).id,
      linked_path: '/chat',
      created_by: userId,
      metadata: input.payload ?? {},
    });
    if (linkError) throw linkError;

    return ok({ itemId: (item as any).id as string });
  } catch (error) {
    return fail({ itemId: null }, error);
  }
}

export async function getTrackerLinksForRoom(roomId: string): Promise<DeterministicResult<any[]>> {
  try {
    const { data, error } = await supabase
      .from('chat_tracker_links' as any)
      .select('*')
      .eq('room_id', roomId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return ok((data ?? []) as any[]);
  } catch (error) {
    return fail([], error);
  }
}
