import { supabase } from '@/integrations/supabase/client';
import { DeterministicResult, fail, ok } from '@/features/chat/lib/types';

export async function setTyping(roomId: string, isTyping: boolean): Promise<DeterministicResult<boolean>> {
  try {
    const user = await supabase.auth.getUser();
    const userId = user.data.user?.id;
    if (!userId) throw new Error('Not authenticated');

    const payload = {
      room_id: roomId,
      user_id: userId,
      is_typing: isTyping,
      expires_at: new Date(Date.now() + 8000).toISOString(),
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase.from('typing_presence' as any).upsert(payload, { onConflict: 'room_id,user_id' } as any);
    if (error) throw error;
    return ok(true);
  } catch (error) {
    return fail(false, error);
  }
}

export async function getTyping(roomId: string): Promise<DeterministicResult<Array<{ user_id: string; is_typing: boolean; expires_at: string }>>> {
  try {
    const { data, error } = await supabase
      .from('typing_presence' as any)
      .select('user_id, is_typing, expires_at')
      .eq('room_id', roomId)
      .gte('expires_at', new Date().toISOString());
    if (error) throw error;
    return ok((data as unknown) as Array<{ user_id: string; is_typing: boolean; expires_at: string }>);
  } catch (error) {
    return fail([], error);
  }
}
