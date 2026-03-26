import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '@/features/auth/auth-context';
import { useRooms } from '@/features/chat/hooks/useRooms';
import { useRoomMessages } from '@/features/chat/hooks/useRoomMessages';
import { useUnreadState } from '@/features/chat/hooks/useUnreadState';
import { useTypingPresence } from '@/features/chat/hooks/useTypingPresence';
import { useRealtimeRoom } from '@/features/chat/hooks/useRealtimeRoom';
import { useMessageActions } from '@/features/chat/hooks/useMessageActions';
import { useCallSession } from '@/features/chat/hooks/useCallSession';
import { useVoiceCall } from '@/features/chat/hooks/useVoiceCall';
import { useRoomPolicy } from '@/features/chat/hooks/useRoomPolicy';
import { useTrackerActions } from '@/features/chat/hooks/useTrackerActions';
import { useMigrationHealth } from '@/features/chat/hooks/useMigrationHealth';
import { searchInRoom, globalSearch } from '@/features/chat/api/search';
import { ConversationSidebar } from '@/features/chat/components/ConversationSidebar';
import { ConversationHeader } from '@/features/chat/components/ConversationHeader';
import { MessageComposer } from '@/features/chat/components/MessageComposer';
import { MessageList } from '@/features/chat/components/MessageList';
import { JumpToUnreadButton } from '@/features/chat/components/JumpToUnreadButton';
import { PinnedMessagesPanel } from '@/features/chat/components/PinnedMessagesPanel';
import { RoomSearchPanel } from '@/features/chat/components/RoomSearchPanel';
import { GlobalSearchPanel } from '@/features/chat/components/GlobalSearchPanel';
import { SharedMediaPanel } from '@/features/chat/components/SharedMediaPanel';
import { RoomContextPanel } from '@/features/chat/components/RoomContextPanel';
import { CallPanel } from '@/features/chat/components/CallPanel';
import { CallHistoryPanel } from '@/features/chat/components/CallHistoryPanel';
import { PolicyCenterPanel } from '@/features/chat/components/PolicyCenterPanel';
import { CannedResponsesPanel } from '@/features/chat/components/CannedResponsesPanel';
import { MigrationHealthPanel } from '@/features/chat/components/MigrationHealthPanel';
import { supabase } from '@/integrations/supabase/client';
import { useRef } from 'react';

// Messaging OS Primitives
import { MOCK_OS_USER } from '@/lib/os-store';

export default function ChatWorkspacePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { userId } = useAuth();
  const roomsQuery = useRooms();
  const rooms = roomsQuery.data ?? [];
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [searchHits, setSearchHits] = useState<any[]>([]);
  const [replyTo, setReplyTo] = useState<any | null>(null);
  
  // Feature 16: Smart Unread Presence
  const roomFocusRef = useRef(true);

  useEffect(() => {
    const handleFocus = () => { roomFocusRef.current = true; };
    const handleBlur = () => { roomFocusRef.current = false; };
    window.addEventListener('focus', handleFocus);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('blur', handleBlur);
    };
  }, []);

  const activeRoom = useMemo(
    () => rooms.find((r) => r.room_id === activeRoomId) ?? null,
    [rooms, activeRoomId]
  );

  useEffect(() => {
    if (!activeRoomId && rooms.length > 0) setActiveRoomId(rooms[0].room_id);
  }, [rooms, activeRoomId]);

  useEffect(() => {
    const roomId = searchParams.get('roomId');
    if (roomId && roomId !== activeRoomId) {
      setActiveRoomId(roomId);
    }
  }, [searchParams, activeRoomId]);

  const messages = useRoomMessages(activeRoomId);
  useRealtimeRoom(activeRoomId);
  const typing = useTypingPresence(activeRoomId);
  const actions = useMessageActions(activeRoomId);
  const calls = useCallSession(activeRoomId);
  const latestCall = (calls.history.data ?? []).find((c: any) => c.status === 'ringing' || c.status === 'active') ?? null;
  const voice = useVoiceCall(latestCall?.call_session_id || latestCall?.id || null, activeRoomId);
  const policy = useRoomPolicy(activeRoomId);
  const tracker = useTrackerActions(activeRoomId, activeRoom?.relationship_id ?? null);
  const migration = useMigrationHealth();
  const { activeRoomUnread } = useUnreadState(activeRoomId);

  useEffect(() => {
    const health = migration.health.data as any;
    if (!health) return;
    const legacyCount = Number(health.legacy_count ?? 0);
    const canonicalCount = Number(health.canonical_count ?? 0);
    if (legacyCount > canonicalCount && !migration.runLive.isPending && !migration.runLive.isSuccess) {
      migration.runLive.mutate();
    }
  }, [migration.health.data, migration.runLive]);

  const reactionsByMessage = useMemo(() => {
    const map: Record<string, string[]> = {};
    (actions.reactionsQuery.data ?? []).forEach((r) => {
      map[r.message_id] = map[r.message_id] ? [...map[r.message_id], r.reaction] : [r.reaction];
    });
    return map;
  }, [actions.reactionsQuery.data]);

  const pinnedSet = useMemo(
    () => new Set((actions.pinsQuery.data ?? []).map((p) => p.message_id)),
    [actions.pinsQuery.data]
  );

  const policyValue = {
    disable_forward: Boolean(policy.policy.data?.security?.disable_forward),
    disable_copy: Boolean(policy.policy.data?.security?.disable_copy),
    disable_export: Boolean(policy.policy.data?.security?.disable_export),
    disable_attachment_download: Boolean(policy.policy.data?.security?.disable_attachment_download),
    restricted_badge: Boolean(policy.policy.data?.security?.restricted_badge),
    watermark_enabled: Boolean(policy.policy.data?.security?.watermark_enabled),
  };

  const [policyDraft, setPolicyDraft] = useState(policyValue);
  useEffect(() => {
    setPolicyDraft(policyValue);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRoomId, policy.policy.data?.security]);

  const [attachments, setAttachments] = useState<any[]>([]);
  useEffect(() => {
    if (!activeRoomId) return;
    supabase
      .from('message_attachments' as any)
      .select('id, file_name, kind')
      .eq('room_id', activeRoomId)
      .order('created_at', { ascending: false })
      .limit(40)
      .then(({ data }) => setAttachments((data ?? []) as any[]));
  }, [activeRoomId, messages.data]);

  const firstUnread = useMemo(() => {
    const list = messages.data ?? [];
    const ownId = userId ?? '';
    return list.find((m) => m.sender_id !== ownId && m.status !== 'read')?.id ?? null;
  }, [messages.data, userId]);

  const jumpToUnread = () => {
    if (!firstUnread) return;
    const el = document.getElementById(`msg-${firstUnread}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  useEffect(() => {
    const messageId = searchParams.get('messageId');
    if (!messageId) return;
    const timer = setTimeout(() => {
      const el = document.getElementById(`msg-${messageId}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setSearchParams((prev) => {
          const next = new URLSearchParams(prev);
          next.delete('messageId');
          return next;
        }, { replace: true });
      }
    }, 80);
    return () => clearTimeout(timer);
  }, [messages.data, searchParams, setSearchParams]);

  const isWatermarked = policyDraft.watermark_enabled || policyDraft.disable_export;
  const isCopyDisabled = policyDraft.disable_copy;

  const watermarkBg = isWatermarked 
    ? `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='300' height='300' opacity='0.03' transform='rotate(-45)'><text x='50' y='150' font-family='sans-serif' font-size='20' font-weight='bold' fill='%23000'>CONFIDENTIAL - ${MOCK_OS_USER.id}</text></svg>")`
    : 'none';

  return (
    <div 
      className="h-full flex overflow-hidden"
      style={{
        userSelect: isCopyDisabled ? 'none' : 'auto',
        WebkitUserSelect: isCopyDisabled ? 'none' : 'auto'
      }}
    >
      <ConversationSidebar rooms={rooms} activeRoomId={activeRoomId} onSelectRoom={setActiveRoomId} />

      <main className="flex-1 min-w-0 flex flex-col relative">
        {/* Feature 2: Watermark Overlay */}
        <div 
          className="absolute inset-0 pointer-events-none z-0" 
          style={{ backgroundImage: watermarkBg }} 
        />
        
        {activeRoom ? (
          <>
            <ConversationHeader
              title={activeRoom.title || 'Room'}
              restricted={policyDraft.restricted_badge}
              onStartCall={() => calls.start.mutate()}
            />

            <MessageList
              messages={messages.data ?? []}
              currentUserId={userId ?? ''}
              unreadMessageId={firstUnread}
              reactionsByMessage={reactionsByMessage}
              pinnedSet={pinnedSet}
              onReact={(messageId, emoji, remove) => actions.react.mutate({ messageId, reaction: emoji, remove })}
              onPinToggle={(messageId, pinned) => (pinned ? actions.unpin.mutate(messageId) : actions.pin.mutate(messageId))}
              onMarkRead={(messageId) => messages.read.mutate(messageId)}
              onDeleteForMe={(messageId) => actions.deleteForMe.mutate(messageId)}
              onDeleteForEveryone={(messageId) => actions.deleteForEveryone.mutate(messageId)}
              onCreateOrder={(messageId) => tracker.createOrderDraft.mutate({ messageId, title: 'Order from chat message' })}
              onCreateTask={(messageId) => tracker.createTask.mutate({ messageId, title: 'Task from chat message' })}
              onReply={(m) => setReplyTo(m)}
              onConvert={(messageId, type) => {
                if (type === 'task') tracker.createTask.mutate({ messageId, title: 'Extracted Task' });
                else tracker.createOrderDraft.mutate({ messageId, title: 'Extracted Order' });
              }}
              onAcceptDeal={(id) => {
                alert(`Signing Deal Snapshot: ${id}`);
                // Implementation would call update mutation with status: 'locked'
              }}
            />

            <JumpToUnreadButton visible={activeRoomUnread > 0} onClick={jumpToUnread} />

            <MessageComposer
              sending={messages.send.isPending}
              onTyping={(isTyping) => typing.updateTyping.mutate(isTyping)}
              onSend={(payload) => messages.send.mutate(payload)}
              onSchedule={(body, runAt) => messages.schedule.mutate({ body, runAt })}
              replyTo={replyTo}
              onCancelReply={() => setReplyTo(null)}
              onOpenApp={(app) => {
                alert(`Mounting Embedded OS Mini-App: ${app}`);
              }}
            />
          </>
        ) : (
          <div className="flex-1 grid place-items-center text-sm text-muted-foreground">No rooms</div>
        )}
      </main>

      <aside className="w-[340px] border-l border-border bg-background/60 overflow-auto p-3 space-y-3">
        <PinnedMessagesPanel pinned={actions.pinsQuery.data ?? []} onJump={(messageId) => {
          const el = document.getElementById(`msg-${messageId}`);
          el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }} />

        <RoomSearchPanel onSearch={async (query) => {
          if (!activeRoomId || !query.trim()) return;
          const res = await searchInRoom(activeRoomId, query.trim());
          setSearchHits(res.data ?? []);
        }} />

        <GlobalSearchPanel onSearch={async (query) => {
          if (!query.trim()) return;
          const res = await globalSearch(query.trim());
          setSearchHits(res.data ?? []);
        }} />

        {searchHits.length > 0 && (
          <section className="border rounded-md p-3 bg-card">
            <h3 className="text-xs font-semibold mb-2">Search Results</h3>
            <div className="space-y-1 max-h-40 overflow-auto">
              {searchHits.map((hit) => (
                <button
                  key={hit.message_id}
                  className="w-full text-left text-xs border rounded px-2 py-1"
                  onClick={() => {
                    if (hit.room_id) setActiveRoomId(hit.room_id);
                    setTimeout(() => {
                      const el = document.getElementById(`msg-${hit.message_id}`);
                      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }, 50);
                  }}
                >
                  {hit.snippet || hit.body}
                </button>
              ))}
            </div>
          </section>
        )}

        <SharedMediaPanel attachments={attachments} />
        <RoomContextPanel roomTitle={activeRoom?.title || 'Room'} relationshipId={activeRoom?.relationship_id || null} />

        <CallPanel
          connected={voice.connected}
          muted={voice.muted}
          error={voice.error}
          onToggleMute={voice.toggleMute}
          onLeave={() => {
            const id = latestCall?.call_session_id || latestCall?.id;
            if (id) calls.leave.mutate(id);
          }}
        />

        <CallHistoryPanel history={calls.history.data ?? []} />

        <PolicyCenterPanel
          value={policyDraft}
          onChange={(next) => setPolicyDraft((p) => ({ ...p, ...next }))}
          onSave={() => policy.update.mutate({ security: policyDraft, retention: { retention_mode: 'keep' } })}
        />

        <CannedResponsesPanel onSelect={(text) => messages.send.mutate({ body: text })} />

        <MigrationHealthPanel
          health={migration.health.data as any}
          running={migration.runDry.isPending || migration.runLive.isPending}
          onDryRun={() => migration.runDry.mutate()}
          onMigrate={() => migration.runLive.mutate()}
        />
      </aside>
    </div>
  );
}
