import { supabase } from '@/integrations/supabase/client';
import { DeterministicResult, fail, ok } from '@/features/chat/lib/types';

async function currentUserId(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  const userId = data.user?.id;
  if (!userId) throw new Error('Not authenticated');
  return userId;
}

export async function createBusinessObjectFromMessage(input: {
  roomId: string;
  messageId: string;
  objectType: 'order' | 'payment' | 'agreement' | 'dispute' | 'task' | 'deal_offer' | 'snapshot';
  payload: Record<string, unknown>;
  title: string;
}): Promise<DeterministicResult<{ objectId: string | null }>> {
  try {
    const userId = await currentUserId();
    const { data: obj, error: objError } = await supabase
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from('os_business_objects' as any)
      .insert({
        room_id: input.roomId,
        object_type: input.objectType,
        source_message_id: input.messageId,
        created_by: userId,
        payload: input.payload,
        status: 'pending',
      })
      .select('id')
      .single();
    if (objError) throw objError;

    // Track in original tracker links for backward compatibility
    await createActionItemFromMessage({
      roomId: input.roomId,
      messageId: input.messageId,
      kind: input.objectType === 'task' ? 'task' : 'reminder',
      title: input.title,
      payload: input.payload,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return ok({ objectId: (obj as any).id as string });
  } catch (error) {
    return fail({ objectId: null }, error);
  }
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: linkError } = await supabase.from('chat_tracker_links' as any).insert({
      room_id: input.roomId,
      message_id: input.messageId,
      link_type: 'order',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      linked_id: (deal as any).id,
      linked_path: '/trading/orders',
      merchant_relationship_id: input.relationshipId,
      created_by: userId,
      metadata: { prefill: { title: input.title, amount: input.amount ?? 0, currency: input.currency ?? 'USDT' } },
    });
    if (linkError) throw linkError;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: linkError } = await supabase.from('chat_tracker_links' as any).insert({
      room_id: input.roomId,
      message_id: input.messageId,
      link_type: input.kind,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      linked_id: (item as any).id,
      linked_path: '/chat',
      created_by: userId,
      metadata: input.payload ?? {},
    });
    if (linkError) throw linkError;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return ok({ itemId: (item as any).id as string });
  } catch (error) {
    return fail({ itemId: null }, error);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getTrackerLinksForRoom(roomId: string): Promise<DeterministicResult<any[]>> {
  try {
    const { data, error } = await supabase
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from('chat_tracker_links' as any)
      .select('*')
      .eq('room_id', roomId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return ok((data ?? []) as any[]);
  } catch (error) {
    return fail([], error);
  }
}
