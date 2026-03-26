import { useMemo } from 'react';
import { useRooms } from '@/features/chat/hooks/useRooms';

export function useUnreadState(activeRoomId: string | null) {
  const { data: rooms = [] } = useRooms();

  const totalUnread = useMemo(
    () => rooms.reduce((sum, room) => sum + Number(room.unread_count || 0), 0),
    [rooms]
  );

  const activeRoomUnread = useMemo(() => {
    if (!activeRoomId) return 0;
    const room = rooms.find((r) => r.room_id === activeRoomId);
    return Number(room?.unread_count || 0);
  }, [activeRoomId, rooms]);

  return { totalUnread, activeRoomUnread, rooms };
}
