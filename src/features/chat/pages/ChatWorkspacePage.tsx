/**
 * ChatWorkspacePage — Unified chat platform
 * One inbox · one room list · merchant_private / merchant_client / merchant_collab
 */
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '@/features/auth/auth-context';
import { useIsMobile } from '@/hooks/use-mobile';
import { useTheme } from '@/lib/theme-context';
import { useChatStore } from '@/lib/chat-store';
import { useRooms } from '../hooks/useRooms';
import { useRoomMessages } from '../hooks/useRoomMessages';
import { usePresence } from '../hooks/usePresence';
import { useTyping } from '../hooks/useTyping';
import { useWebRTC } from '../hooks/useWebRTC';
import { getMessageById } from '../api/chat';
import { ConversationSidebar } from '../components/ConversationSidebar';
import { ConversationHeader } from '../components/ConversationHeader';
import { MessageList } from '../components/MessageList';
import { MessageComposer } from '../components/MessageComposer';
import { CallOverlay } from '../components/CallOverlay';
import { cn } from '@/lib/utils';

export default function ChatWorkspacePage() {
  const [searchParams] = useSearchParams();
  const { userId, merchantProfile } = useAuth();
  const { settings } = useTheme();
  const isMobile = useIsMobile();

  const meId = userId ?? '';

  // ── rooms ────────────────────────────────────────────────────────────────
  const roomsQuery = useRooms();
  const rooms = roomsQuery.data ?? [];

  // ── active room ───────────────────────────────────────────────────────────
  const activeRoomId   = useChatStore((s) => s.activeRoomId);
  const setActiveRoom  = useChatStore((s) => s.setActiveRoom);
  const pendingNav     = useChatStore((s) => s.pendingNotificationNav);
  const pendingVer     = useChatStore((s) => s.pendingNotificationNavVersion);
  const setPendingNav  = useChatStore((s) => s.setPendingNav);
  const setAnchor      = useChatStore((s) => s.setAnchor);
  const setAttention   = useChatStore((s) => s.setAttention);

  // URL → room/message (runs whenever the URL changes OR rooms finish loading)
  useEffect(() => {
    const urlRoom = searchParams.get('roomId');
    const urlMessage = searchParams.get('messageId');

    if (urlRoom && urlRoom !== activeRoomId) {
      setActiveRoom(urlRoom);
      return;
    }

    if (!urlRoom && urlMessage) {
      let cancelled = false;
      void (async () => {
        try {
          const targetMessage = await getMessageById(urlMessage);
          if (cancelled || !targetMessage?.room_id) return;
          if (targetMessage.room_id !== activeRoomId) {
            setActiveRoom(targetMessage.room_id);
          }
          setAnchor(urlMessage);
        } catch (error) {
          console.warn('[chat] failed to resolve message deep-link', error);
        }
      })();
      return () => {
        cancelled = true;
      };
    }

    if (!urlRoom && !urlMessage && !activeRoomId && rooms.length > 0) {
      setActiveRoom(rooms[0].room_id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, rooms.length]);

  // notification deep-link  (runs whenever pendingNav is set)
  useEffect(() => {
    if (!pendingNav) return;
    const targetRoom = pendingNav.conversationId;
    if (targetRoom) {
      setActiveRoom(targetRoom);
    }
    if (pendingNav.messageId) setAnchor(pendingNav.messageId);
    setPendingNav(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingVer]);

  // attention tracking
  useEffect(() => {
    setAttention({ inChatModule: true });
    return () => setAttention({ inChatModule: false, activeConversationVisible: false });
  }, [setAttention]);

  useEffect(() => {
    setAttention({ activeConversationVisible: !!activeRoomId });
  }, [activeRoomId, setAttention]);

  // ── messages ──────────────────────────────────────────────────────────────
  const {
    messages, isLoading: msgsLoading, send, edit, delete: del, react,
  } = useRoomMessages(activeRoomId);

  // ── typing ────────────────────────────────────────────────────────────────
  const { startTyping, stopTyping } = useTyping(activeRoomId);

  // ── presence ─────────────────────────────────────────────────────────────
  usePresence();

  // ── calls ─────────────────────────────────────────────────────────────────
  const webrtc = useWebRTC(activeRoomId);

  // ── layout state ─────────────────────────────────────────────────────────
  const [showSidebar, setShowSidebar] = useState(!isMobile);
  const activeRoom = rooms.find((r) => r.room_id === activeRoomId) ?? null;

  // send handler — clientNonce is generated here so both onMutate and
  // mutationFn share the same value, preventing realtime dedup failures.
  const handleSend = useCallback(
    (content: string, opts?: {
      replyToId?: string;
      expiresAt?: string;
      viewOnce?: boolean;
      attachmentId?: string;
      type?: ChatMessageType;
      metadata?: Record<string, unknown>;
    }) => {
      if (!activeRoomId || !content.trim()) return;

      const messageType = opts?.type ?? 'text';

      send.mutate({
        roomId:       activeRoomId,
        content:      content.trim(),
        type:         messageType,
        metadata:     opts?.metadata as SendMessageInput['metadata'],
        clientNonce:  crypto.randomUUID(),
        replyToId:    opts?.replyToId   ?? null,
        expiresAt:    opts?.expiresAt   ?? null,
        viewOnce:     opts?.viewOnce    ?? false,
        attachmentId: opts?.attachmentId ?? null,
      });
      stopTyping();
    },
    [activeRoomId, send, stopTyping],
  );

  const isRTL = settings.language === 'ar';

  return (
    <div
      className={cn(
        'flex h-full bg-background overflow-hidden',
        isRTL && 'flex-row-reverse',
      )}
    >
      {/* ── Call overlay (Phase 4) ────────────────────────────────────────── */}
      <CallOverlay webrtc={webrtc} />

      {/* ── Sidebar ────────────────────────────────────────────────────────── */}
      {(showSidebar || !isMobile) && (
        <ConversationSidebar
          rooms={rooms}
          activeRoomId={activeRoomId}
          onSelectRoom={(id) => {
            setActiveRoom(id);
            if (isMobile) setShowSidebar(false);
          }}
          isLoading={roomsQuery.isLoading}
          meId={meId}
        />
      )}

      {/* ── Main pane ──────────────────────────────────────────────────────── */}
      <div className="flex flex-col flex-1 min-w-0 h-full">
        {activeRoom ? (
          <>
            <ConversationHeader
              room={activeRoom}
              meId={meId}
              onToggleSidebar={() => setShowSidebar((v) => !v)}
              onStartCall={
                activeRoom.room_type === 'merchant_private'
                  ? webrtc.startCall
                  : undefined
              }
            />
            <MessageList
              messages={messages}
              meId={meId}
              isLoading={msgsLoading}
              roomType={activeRoom.room_type}
              onReact={(msgId, emoji, remove) =>
                react.mutate({ messageId: msgId, emoji, remove })
              }
              onEdit={(msgId, content) => edit.mutate({ messageId: msgId, content })}
              onDelete={(msgId, forEveryone) =>
                del.mutate({ messageId: msgId, forEveryone })
              }
            />
            <MessageComposer
              roomId={activeRoomId!}
              roomType={activeRoom.room_type}
              onSend={handleSend}
              onTyping={startTyping}
              meId={meId}
            />
          </>
        ) : (
          <div className="flex flex-col items-center justify-center flex-1 gap-3 text-muted-foreground">
            <p className="text-sm font-medium">
              {rooms.length === 0 ? 'No conversations yet' : 'Select a conversation'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
