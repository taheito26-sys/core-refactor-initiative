import { useQuery } from '@tanstack/react-query';
import { getRooms } from '@/features/chat/api/rooms';

export function useRooms() {
  return useQuery({
    queryKey: ['chat', 'rooms'],
    queryFn: async () => {
      const res = await getRooms();
      if (!res.ok) throw new Error(res.error ?? 'Fetch failed');
      return res.data || [];
    },
    staleTime: 5000,
  });
}
