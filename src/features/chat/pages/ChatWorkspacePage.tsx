/**
 * ChatWorkspacePage — Unified chat platform
 * One inbox · one room list · merchant_private / merchant_client / merchant_collab
 * Mobile: WhatsApp-style single-pane (list OR thread, never both)
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
import type { ChatMessageType, SendMessageInput } from '../types';
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

  // ── mobile single-pane state ────────────────────────────────────────────
  // On mobile: 'list' = show sidebar, 'thread' = show active chat
  const [mobilePane, setMobilePane] = useState<'list' | 'thread'>('list');

  // URL → room/message (runs whenever the URL changes OR rooms finish loading)
  useEffect(() => {
    const urlRoom = searchParams.get('roomId');
    const urlMessage = searchParams.get('messageId');

    if (urlRoom && urlRoom !== activeRoomId) {
      setActiveRoom(urlRoom);
      if (isMobile) setMobilePane('thread');
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
          if (isMobile) setMobilePane('thread');
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
      // On mobile, stay on list until user taps
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, rooms.length]);

  // notification deep-link  (runs whenever pendingNav is set)
  useEffect(() => {
    if (!pendingNav) return;
    const targetRoom = pendingNav.conversationId;
    if (targetRoom) {
      setActiveRoom(targetRoom);
      if (isMobile) setMobilePane('thread');
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

  // Mobile: select a room → switch to thread pane
  const handleSelectRoom = useCallback((id: string) => {
    setActiveRoom(id);
    if (isMobile) setMobilePane('thread');
  }, [isMobile, setActiveRoom]);

  // Mobile: back button → return to list
  const handleMobileBack = useCallback(() => {
    setMobilePane('list');
  }, []);

  // send handler
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

  // ── Mobile: single-pane rendering ────────────────────────────────────────
  if (isMobile) {
    return (
      <div className="flex flex-col h-full bg-background overflow-hidden">
        <CallOverlay webrtc={webrtc} />

        {mobilePane === 'list' ? (
          /* ── Conversation list: full width ── */
          <ConversationSidebar
            rooms={rooms}
            activeRoomId={activeRoomId}
            onSelectRoom={handleSelectRoom}
            isLoading={roomsQuery.isLoading}
            meId={meId}
          />
        ) : (
          /* ── Chat thread: full width ── */
          <div className="flex flex-col flex-1 min-w-0 h-full">
            {activeRoom ? (
              <>
                <ConversationHeader
                  room={activeRoom}
                  meId={meId}
                  onToggleSidebar={handleMobileBack}
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
                <p className="text-sm font-medium">Select a conversation</p>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // ── Desktop/tablet: split layout ──────────────────────────────────────────
  return (
    <div
      className={cn(
        'flex h-full bg-background overflow-hidden',
        isRTL && 'flex-row-reverse',
      )}
    >
      <CallOverlay webrtc={webrtc} />

      {(showSidebar || !isMobile) && (
        <ConversationSidebar
          rooms={rooms}
          activeRoomId={activeRoomId}
          onSelectRoom={(id) => {
            setActiveRoom(id);
          }}
          isLoading={roomsQuery.isLoading}
          meId={meId}
        />
      )}

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
