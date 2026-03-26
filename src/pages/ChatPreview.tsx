import { useEffect, useMemo, useState } from 'react';
import { OsRoom, OsMessage } from '@/lib/os-store';
import { ConversationSidebar } from '@/features/chat/components/ConversationSidebar';
import { ConversationHeader } from '@/features/chat/components/ConversationHeader';
import { MessageTimeline } from '@/features/chat/components/MessageTimeline';
import { MessageComposer } from '@/features/chat/components/MessageComposer';

const ME = 'preview-merchant';

const PREVIEW_ROOMS: OsRoom[] = [
  {
    id: 'preview-room-1',
    name: 'Preview Deal Room',
    type: 'deal',
    lane: 'Deals',
    security_policies: { disable_forwarding: true, disable_copy: true, disable_export: true, watermark: true },
    retention_policy: '30d',
  },
  {
    id: 'preview-room-2',
    name: 'Preview Support',
    type: 'standard',
    lane: 'Customers',
    security_policies: { disable_forwarding: false, disable_copy: false, disable_export: false, watermark: false },
    retention_policy: 'indefinite',
  },
];

export default function ChatPreview() {
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [messages, setMessages] = useState<OsMessage[]>([
    {
      id: 'preview-msg-1',
      type: 'message',
      room_id: 'preview-room-1',
      sender_id: 'peer-merchant',
      content: 'Preview secure room message.',
      permissions: { forwardable: false, exportable: false, copyable: false, ai_readable: false },
      retention_policy: '30d',
      created_at: new Date(Date.now() - 120000).toISOString(),
    },
    {
      id: 'preview-msg-2',
      type: 'message',
      room_id: 'preview-room-2',
      sender_id: 'peer-merchant',
      content: 'Need help with tracking details.',
      permissions: { forwardable: true, exportable: true, copyable: true, ai_readable: true },
      retention_policy: 'indefinite',
      created_at: new Date(Date.now() - 60000).toISOString(),
    },
  ]);

  useEffect(() => {
    if (!activeRoomId) setActiveRoomId(PREVIEW_ROOMS[0].id);
  }, [activeRoomId]);

  const activeRoom = useMemo(() => PREVIEW_ROOMS.find((room) => room.id === activeRoomId) || null, [activeRoomId]);
  const activeItems = useMemo(() => messages.filter((message) => message.room_id === activeRoomId), [messages, activeRoomId]);

  const handleSend = (content: string) => {
    if (!activeRoom) return;

    setMessages((prev) => [
      ...prev,
      {
        id: `preview-msg-${Date.now()}`,
        type: 'message',
        room_id: activeRoom.id,
        sender_id: ME,
        content,
        permissions: {
          forwardable: !activeRoom.security_policies.disable_forwarding,
          exportable: !activeRoom.security_policies.disable_export,
          copyable: !activeRoom.security_policies.disable_copy,
          ai_readable: true,
        },
        retention_policy: activeRoom.retention_policy,
        created_at: new Date().toISOString(),
      },
    ]);
  };

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <ConversationSidebar conversations={PREVIEW_ROOMS} activeRoomId={activeRoomId} onSelectRoom={setActiveRoomId} />
      {activeRoom ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%' }}>
          <ConversationHeader
            name={activeRoom.name}
            nickname={activeRoom.type}
            onBack={() => setActiveRoomId(null)}
            onSearchToggle={() => {}}
          />
          <MessageTimeline
            messages={activeItems}
            currentUserId={ME}
            counterpartyName={activeRoom.name}
            scrollRef={() => {}}
            onReply={() => {}}
          />
          <MessageComposer
            onSend={handleSend}
            onTyping={() => {}}
            replyTo={null}
            onCancelReply={() => {}}
          />
        </div>
      ) : (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Select a room</div>
      )}
    </div>
  );
}
