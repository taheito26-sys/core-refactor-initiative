/**
 * ChatWorkspacePage — Unified chat platform
 * One inbox · one room list · merchant_private / merchant_client / merchant_collab
 * Mobile: WhatsApp-style single-pane (list OR thread, never both)
 * Calling: voice + video, call history panel, call summary messages
 * Phases wired: 1-24, 34, 41-50, 59, 69, 9 (search), 18 (lightbox),
 *               reply-to flow, typing indicator, room info panel
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '@/features/auth/auth-context';
import { useIsMobile } from '@/hooks/use-mobile';
import { useTheme } from '@/lib/theme-context';
import { useChatStore, typingUsersInRoom } from '@/lib/chat-store';
import { useQueryClient } from '@tanstack/react-query';
import { useRooms, ROOMS_KEY } from '../hooks/useRooms';
import { useRoomMessages } from '../hooks/useRoomMessages';
import { toast } from 'sonner';
import { useTyping } from '../hooks/useTyping';
import { useWebRTC } from '../hooks/useWebRTC';
import { getMessageById, clearChatForMe, toggleMuteRoom, getQatarMarketRoom, forwardMessage } from '../api/chat';
import type { ChatMessage, ChatMessageType, SendMessageInput } from '../types';
import { ConversationSidebar } from '../components/ConversationSidebar';
import { ConversationHeader } from '../components/ConversationHeader';
import { MessageList } from '../components/MessageList';
import { MessageComposer } from '../components/MessageComposer';
import { CallOverlay } from '../components/CallOverlay';
import { CallHistoryPanel } from '../components/CallHistoryPanel';
import { MessageSearch } from '../components/MessageSearch';
import { ReplyPreview } from '../components/ReplyPreview';
import { RoomInfoPanel } from '../components/RoomInfoPanel';
import { ImageLightbox } from '../components/ImageLightbox';
import { ForwardMessageModal } from '../components/ForwardMessageModal';
import { NewChatModal } from '../components/NewChatModal';
import { ScreenshotProtectionOverlay } from '../components/ScreenshotProtectionOverlay';
import { PrivacyDashboard } from '../components/PrivacyDashboard';
import { TradingRoomPrivacyBanner } from '../components/TradingRoomPrivacyBanner';
import { MarketOfferComposer } from '../components/MarketOfferComposer';
import { MarketOffersPanel } from '../components/MarketOffersPanel';
import { usePrivacyGuard } from '../hooks/usePrivacyGuard';
import { useMarketOffers } from '../hooks/useMarketOffers';
import { usePrivacySettings } from '../hooks/usePrivacySettings';
import { resolveMessageSenderLabel } from '../lib/identity';
import { cn } from '@/lib/utils';

export default function ChatWorkspacePage() {
  const [searchParams] = useSearchParams();
  const { userId, merchantProfile } = useAuth();
  const { settings } = useTheme();
  const isMobile = useIsMobile();
  const qc = useQueryClient();
  const { settings: privacySettings } = usePrivacySettings();

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
  const [mobilePane, setMobilePane] = useState<'list' | 'thread'>('list');

  // ── call history panel toggle ──────────────────────────────────────────
  const [showCallHistory, setShowCallHistory] = useState(false);

  // ── Phase 9: message search toggle ────────────────────────────────────
  const [showSearch, setShowSearch] = useState(false);

  // ── Phase 74: room info panel ─────────────────────────────────────────
  const [showRoomInfo, setShowRoomInfo] = useState(false);

  // ── Phase 18: image lightbox ──────────────────────────────────────────
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  // ── Reply-to state ────────────────────────────────────────────────────
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);

  // ── Forward state (Phase 12) ──────────────────────────────────────────
  const [forwardMsg, setForwardMsg] = useState<ChatMessage | null>(null);
  const [showNewChat, setShowNewChat] = useState(false);
  const [showPrivacyDashboard, setShowPrivacyDashboard] = useState(false);

  // URL → room/message
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
      return () => { cancelled = true; };
    }

    if (!urlRoom && !urlMessage && !activeRoomId && rooms.length > 0) {
      setActiveRoom(rooms[0].room_id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, rooms.length]);

  // notification deep-link
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
  const typingUsers = useChatStore(typingUsersInRoom(activeRoomId ?? ''));

  // ── calls ─────────────────────────────────────────────────────────────────
  const webrtc = useWebRTC(activeRoomId);

  // ── privacy guard (Phases 6, 8, 9, 14) ─────────────────────────────────
  const { containerRef: privacyContainerRef, isBlurred, screenshotDetected, screenshotNotice } = usePrivacyGuard({
    userId: meId,
    roomId: activeRoomId,
    screenshotProtection: privacySettings.screenshot_protection ?? false,
    copyProtection: privacySettings.copy_disabled ?? false,
    blurOnLoseFocus: privacySettings.screenshot_protection ?? false,
  });
  useEffect(() => {
    setShowCallHistory(false);
    setShowSearch(false);
    setShowRoomInfo(false);
    setReplyTo(null);
  }, [activeRoomId]);

  // ── layout state ─────────────────────────────────────────────────────────
  const [showSidebar, setShowSidebar] = useState(!isMobile);
  const activeRoom = rooms.find((r) => r.room_id === activeRoomId) ?? null;
  const isPrivateRoom = activeRoom?.room_type === 'merchant_private';
  const isQatarMarketRoom = activeRoom?.room_type === 'merchant_collab'
    && (activeRoom.name ?? '').toLowerCase() === 'qatar p2p market';
  const canForwardFromActiveRoom = !(activeRoom?.policy?.disable_forwarding ?? false);
  const marketOffers = useMarketOffers(activeRoomId, !!isQatarMarketRoom);

  // Mobile: select a room → switch to thread pane
  const handleSelectRoom = useCallback((id: string) => {
    setActiveRoom(id);
    if (isMobile) setMobilePane('thread');
  }, [isMobile, setActiveRoom]);

  // Mobile: back button → return to list
  const handleMobileBack = useCallback(() => {
    setMobilePane('list');
  }, []);

  // Reply handler
  const handleReply = useCallback((msg: ChatMessage) => {
    setReplyTo(msg);
  }, []);

  // Image lightbox handler
  const handleImageOpen = useCallback((src: string) => {
    setLightboxSrc(src);
  }, []);

  // Forward handler (Phase 12)
  const handleForward = useCallback((msg: ChatMessage) => {
    if (!canForwardFromActiveRoom) {
      toast.error('Forwarding is disabled for this room');
      return;
    }
    setForwardMsg(msg);
  }, [canForwardFromActiveRoom]);

  const handleForwardSend = useCallback(async (messageId: string, targetRoomId: string) => {
    try {
      await forwardMessage(messageId, targetRoomId);
      toast.success('Message forwarded');
      qc.invalidateQueries({ queryKey: ['chat', 'messages', targetRoomId] });
      qc.invalidateQueries({ queryKey: ROOMS_KEY });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to forward message';
      toast.error(message);
    }
  }, [qc]);

  // Search jump handler
  const handleSearchJump = useCallback((messageId: string) => {
    setAnchor(messageId);
    const el = document.getElementById(`msg-${messageId}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [setAnchor]);

  // send handler
  const handleSend = useCallback(
    (content: string, opts?: {
      replyToId?: string;
      expiresAt?: string;
      viewOnce?: boolean;
      watermarkText?: string | null;
      attachmentId?: string;
      type?: ChatMessageType;
      metadata?: Record<string, unknown>;
    }) => {
      if (!activeRoomId) return;
      const normalizedContent = content.trim();
      const hasAttachment = !!opts?.attachmentId;
      if (!normalizedContent && !hasAttachment) return;
      const messageType = opts?.type ?? 'text';
      const replyId = opts?.replyToId ?? replyTo?.id ?? null;

      const metadata = { ...opts?.metadata } as SendMessageInput['metadata'];
      if (replyTo && !opts?.replyToId) {
        (metadata as Record<string, unknown>).reply_preview = {
          sender_name: resolveMessageSenderLabel(replyTo.sender_id, replyTo.sender_name),
          content: replyTo.content.slice(0, 100),
        };
      }

      send.mutate({
        roomId:        activeRoomId,
        content:       normalizedContent,
        type:          messageType,
        metadata,
        clientNonce:   crypto.randomUUID(),
        replyToId:     replyId,
        expiresAt:     opts?.expiresAt   ?? null,
        viewOnce:      opts?.viewOnce    ?? false,
        watermarkText: opts?.watermarkText ?? null,
        attachmentId:  opts?.attachmentId ?? null,
      });
      stopTyping();
      setReplyTo(null);
    },
    [activeRoomId, send, stopTyping, replyTo],
  );

  // ── Mute state (derived from room list) ─────────────────────────────────
  const isRoomMuted = activeRoom?.is_muted ?? false;

  // ── Clear chat handler ──────────────────────────────────────────────────
  const handleClearChat = useCallback(async () => {
    if (!activeRoomId) return;
    const confirmed = window.confirm('Clear this chat? Messages will be hidden for you.');
    if (!confirmed) return;
    try {
      await clearChatForMe(activeRoomId);
      qc.invalidateQueries({ queryKey: ['chat', 'messages', activeRoomId] });
      toast.success('Chat cleared');
    } catch {
      toast.error('Failed to clear chat');
    }
  }, [activeRoomId, qc]);

  // ── Mute toggle handler ─────────────────────────────────────────────────
  const handleMuteToggle = useCallback(async () => {
    if (!activeRoomId) return;
    try {
      await toggleMuteRoom(activeRoomId, !isRoomMuted);
      qc.invalidateQueries({ queryKey: ROOMS_KEY });
      toast.success(isRoomMuted ? 'Unmuted' : 'Muted');
    } catch {
      toast.error('Failed to update mute');
    }
  }, [activeRoomId, isRoomMuted, qc]);

  // ── Trading Room auto-join ──────────────────────────────────────────────
  useEffect(() => {
    if (!userId || !merchantProfile?.merchant_id) return;
    getQatarMarketRoom().catch(() => {});
  }, [userId, merchantProfile?.merchant_id]);

  // ── Shared header props builder ─────────────────────────────────────────
  const headerCallProps = isPrivateRoom ? {
    onStartCall: () => webrtc.startCall(false),
    onStartVideoCall: () => webrtc.startCall(true),
    onToggleCallHistory: () => setShowCallHistory((v) => !v),
  } : {};

  // ── Thread content (shared between mobile and desktop) ─────────────────
  const renderThread = (onBack?: () => void) => {
    if (!activeRoom) {
      return (
        <div className="flex flex-col items-center justify-center flex-1 gap-3 text-muted-foreground">
          <p className="text-sm font-medium">
            {rooms.length === 0 ? 'No conversations yet' : 'Select a conversation'}
          </p>
        </div>
      );
    }

    return (
      <div ref={privacyContainerRef} className="flex flex-col flex-1 min-h-0 relative">
        {/* Phases 6, 8, 9: Screenshot/blur overlays */}
        <ScreenshotProtectionOverlay
          screenshotDetected={screenshotDetected}
          screenshotNotice={screenshotNotice}
          isBlurred={isBlurred}
        />

        <ConversationHeader
          room={activeRoom}
          meId={meId}
          onToggleSidebar={onBack ?? (() => setShowSidebar((v) => !v))}
          onSearchToggle={() => setShowSearch((v) => !v)}
          onViewInfo={() => setShowRoomInfo((v) => !v)}
          onMuteToggle={handleMuteToggle}
          onClearChat={handleClearChat}
          onPrivacyDashboard={() => setShowPrivacyDashboard(true)}
          isMuted={isRoomMuted}
          {...headerCallProps}
        />

        {/* Phase 9: Message search bar */}
        {showSearch && (
          <MessageSearch
            messages={messages}
            onJumpTo={handleSearchJump}
            onClose={() => setShowSearch(false)}
          />
        )}

        {/* Privacy watermark banner for trading/collab rooms */}
        {activeRoom.room_type === 'merchant_collab' && (
          <TradingRoomPrivacyBanner roomName={activeRoom.name} />
        )}

        {isQatarMarketRoom && activeRoomId && (
          <>
            <MarketOffersPanel
              offers={marketOffers.offers}
              myUserId={meId}
              onCancelOffer={(offerId) => {
                marketOffers.cancel.mutate(offerId, {
                  onSuccess: () => toast.success('Offer cancelled'),
                  onError: () => toast.error('Failed to cancel offer'),
                });
              }}
            />
            <MarketOfferComposer
              roomId={activeRoomId}
              isSubmitting={marketOffers.create.isPending}
              onSubmit={async (input) => {
                await marketOffers.create.mutateAsync(input);
                toast.success('Offer posted to Qatar P2P Market');
              }}
            />
          </>
        )}

        {showCallHistory && activeRoomId ? (
          <div className="flex-1 overflow-y-auto bg-background">
            <div className="px-4 py-3 border-b border-border">
              <h3 className="text-sm font-bold text-foreground">Call History</h3>
            </div>
            <CallHistoryPanel
              roomId={activeRoomId}
              meId={meId}
              onCallback={() => {
                setShowCallHistory(false);
                webrtc.startCall(false);
              }}
            />
          </div>
        ) : (
          <>
            <MessageList
              messages={messages}
              meId={meId}
              isLoading={msgsLoading}
              roomType={activeRoom.room_type}
              watermarkEnabled={activeRoom.policy?.watermark_enabled ?? false}
              typingUserIds={typingUsers}
              onReact={(msgId, emoji, remove) =>
                react.mutate({ messageId: msgId, emoji, remove })
              }
              onEdit={(msgId, content) => edit.mutate({ messageId: msgId, content })}
              onDelete={(msgId, forEveryone) =>
                del.mutate({ messageId: msgId, forEveryone })
              }
              onReply={handleReply}
              onForward={canForwardFromActiveRoom ? handleForward : undefined}
              onImageOpen={handleImageOpen}
            />
            {/* Reply preview above composer */}
            {replyTo && (
              <ReplyPreview message={replyTo} onClear={() => setReplyTo(null)} />
            )}
            <MessageComposer
              roomId={activeRoomId!}
              roomType={activeRoom.room_type}
              roomPolicy={activeRoom.policy}
              onSend={handleSend}
              onTyping={startTyping}
              meId={meId}
              onPrivacyDashboard={() => setShowPrivacyDashboard(true)}
            />
          </>
        )}
      </div>
    );
  };

  // ── Image lightbox overlay ──────────────────────────────────────────────
  const lightbox = lightboxSrc ? (
    <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
  ) : null;

  // ── Room info panel overlay ─────────────────────────────────────────────
  const roomInfo = showRoomInfo && activeRoom ? (
    <RoomInfoPanel room={activeRoom} onClose={() => setShowRoomInfo(false)} />
  ) : null;

  // ── Forward modal (Phase 12) ─────────────────────────────────────────────
  const forwardModal = forwardMsg ? (
    <ForwardMessageModal
      message={forwardMsg}
      rooms={rooms}
      onForward={handleForwardSend}
      onClose={() => setForwardMsg(null)}
    />
  ) : null;

  // ── New chat modal ──────────────────────────────────────────────────────
  const newChatModal = showNewChat ? (
    <NewChatModal
      meId={meId}
      onSelectRoom={(roomId) => {
        setActiveRoom(roomId);
        if (isMobile) setMobilePane('thread');
        qc.invalidateQueries({ queryKey: ROOMS_KEY });
      }}
      onClose={() => setShowNewChat(false)}
    />
  ) : null;

  // ── Privacy dashboard overlay (Phase 25) ────────────────────────────────
  const privacyPanel = showPrivacyDashboard ? (
    <PrivacyDashboard onClose={() => setShowPrivacyDashboard(false)} />
  ) : null;

  // ── Mobile: single-pane rendering ────────────────────────────────────────
  if (isMobile) {
    return (
      <div className={cn('flex flex-col h-full bg-background overflow-hidden')}>
        <CallOverlay webrtc={webrtc} />
        {lightbox}
        {roomInfo}
        {forwardModal}
        {newChatModal}
        {privacyPanel}
        {mobilePane === 'list' ? (
          <div className="flex flex-col flex-1 min-w-0 h-full chat-pane-enter-left">
            <ConversationSidebar
              rooms={rooms}
              activeRoomId={activeRoomId}
              onSelectRoom={handleSelectRoom}
              onNewChat={() => setShowNewChat(true)}
              isLoading={roomsQuery.isLoading}
              meId={meId}
            />
          </div>
        ) : (
          <div className="flex flex-col flex-1 min-w-0 h-full chat-pane-enter-right">
            {renderThread(handleMobileBack)}
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
      {lightbox}
      {roomInfo}
      {forwardModal}
      {newChatModal}
      {privacyPanel}

      {(showSidebar || !isMobile) && (
        <ConversationSidebar
          rooms={rooms}
          activeRoomId={activeRoomId}
          onSelectRoom={(id) => setActiveRoom(id)}
          onNewChat={() => setShowNewChat(true)}
          isLoading={roomsQuery.isLoading}
          meId={meId}
        />
      )}

      <div className="flex flex-col flex-1 min-w-0 h-full">
        {renderThread()}
      </div>
    </div>
  );
}


