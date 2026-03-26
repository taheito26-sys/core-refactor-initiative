import { useState, useEffect, useMemo, useRef } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/auth-context';
import { ChannelIdentity, OsRoom, OsMessage, OsBusinessObject } from '@/lib/os-store';

import { ConversationSidebar } from '@/features/chat/components/ConversationSidebar';
import { ConversationHeader } from '@/features/chat/components/ConversationHeader';
import { MessageTimeline } from '@/features/chat/components/MessageTimeline';
import { MessageComposer } from '@/features/chat/components/MessageComposer';

import { ModernSidebar } from '@/features/chat/components/modern/ModernSidebar';
import { ModernHeader } from '@/features/chat/components/modern/ModernHeader';
import { ModernTimeline } from '@/features/chat/components/modern/ModernTimeline';
import { ModernComposer } from '@/features/chat/components/modern/ModernComposer';

type DbRoom = {
  id: string;
  name: string;
  type: OsRoom['type'];
  lane: OsRoom['lane'];
  security_policies: OsRoom['security_policies'];
  retention_policy: OsRoom['retention_policy'];
};

type DbMessage = {
  id: string;
  room_id: string;
  thread_id: string | null;
  sender_merchant_id: string;
  sender_identity_id: string | null;
  content: string;
  permissions: OsMessage['permissions'];
  expires_at: string | null;
  retention_policy: OsMessage['retention_policy'];
  view_limit: number | null;
  read_at: string | null;
  created_at: string;
};

type DbBusinessObject = {
  id: string;
  room_id: string;
  object_type: OsBusinessObject['object_type'];
  source_message_id: string | null;
  created_by_merchant_id: string;
  state_snapshot_hash: string | null;
  payload: Record<string, unknown>;
  status: OsBusinessObject['status'];
  created_at: string;
};

function toOsMessage(row: DbMessage): OsMessage {
  return {
    id: row.id,
    type: 'message',
    room_id: row.room_id,
    thread_id: row.thread_id || undefined,
    sender_id: row.sender_merchant_id,
    sender_identity_id: row.sender_identity_id || undefined,
    content: row.content,
    permissions: row.permissions,
    expires_at: row.expires_at || undefined,
    retention_policy: row.retention_policy,
    view_limit: row.view_limit || undefined,
    read_at: row.read_at || undefined,
    created_at: row.created_at,
  };
}

function toOsBusinessObject(row: DbBusinessObject): OsBusinessObject {
  return {
    id: row.id,
    type: 'business_object',
    room_id: row.room_id,
    object_type: row.object_type,
    source_message_id: row.source_message_id || undefined,
    created_by: row.created_by_merchant_id,
    state_snapshot_hash: row.state_snapshot_hash || undefined,
    payload: row.payload || {},
    status: row.status,
    created_at: row.created_at,
  };
}

function generateSnapshotHash(): string {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

export default function ChatPage() {
  const { merchantProfile } = useAuth();
  const merchantId = merchantProfile?.merchant_id ?? null;
  const queryClient = useQueryClient();

  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [layoutTheme, setLayoutTheme] = useState<'classic' | 'modern'>('modern');
  const [miniApp, setMiniApp] = useState<'calculator' | 'order' | null>(null);

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

  const { data: rooms = [], isLoading: roomsLoading } = useQuery({
    queryKey: ['os-rooms', merchantId],
    enabled: !!merchantId,
    queryFn: async (): Promise<OsRoom[]> => {
      const { data, error } = await (supabase as any)
        .from('os_room_members')
        .select('room_id, os_rooms(*)')
        .eq('merchant_id', merchantId);

      if (error) throw error;

      const list = (data || [])
        .map((row: any) => row.os_rooms as DbRoom | null)
        .filter((room): room is DbRoom => Boolean(room))
        .map((room: DbRoom) => ({
          id: room.id,
          name: room.name,
          type: room.type,
          lane: room.lane,
          security_policies: room.security_policies,
          retention_policy: room.retention_policy,
        }));

      return list;
    },
    staleTime: 15_000,
  });

  useEffect(() => {
    if (!activeRoomId && rooms.length > 0) {
      setActiveRoomId(rooms[0].id);
    }
  }, [activeRoomId, rooms]);

  const { data: identitiesById = {} } = useQuery({
    queryKey: ['os-identities', rooms.map((r) => r.id).join('|')],
    enabled: rooms.length > 0,
    queryFn: async (): Promise<Record<string, ChannelIdentity>> => {
      const roomIds = rooms.map((r) => r.id);
      const membersRes = await (supabase as any)
        .from('os_room_members')
        .select('merchant_id')
        .in('room_id', roomIds);

      if (membersRes.error) throw membersRes.error;

      const merchantIds = Array.from(new Set((membersRes.data || []).map((m: any) => m.merchant_id).filter(Boolean)));
      if (merchantIds.length === 0) return {};

      const identitiesRes = await (supabase as any)
        .from('os_channel_identities')
        .select('id, provider_type, provider_uid, confidence_level')
        .in('merchant_id', merchantIds);

      if (identitiesRes.error) throw identitiesRes.error;

      const out: Record<string, ChannelIdentity> = {};
      for (const row of identitiesRes.data || []) {
        out[row.id] = {
          id: row.id,
          provider_type: row.provider_type as ChannelIdentity['provider_type'],
          provider_uid: row.provider_uid,
          confidence_level: row.confidence_level as ChannelIdentity['confidence_level'],
        };
      }
      return out;
    },
    staleTime: 30_000,
  });

  const { data: activeItems = [] } = useQuery({
    queryKey: ['os-timeline', activeRoomId],
    enabled: !!activeRoomId,
    queryFn: async (): Promise<(OsMessage | OsBusinessObject)[]> => {
      const [messagesRes, objectsRes] = await Promise.all([
        (supabase as any)
          .from('os_messages')
          .select('id, room_id, thread_id, sender_merchant_id, sender_identity_id, content, permissions, expires_at, retention_policy, view_limit, read_at, created_at')
          .eq('room_id', activeRoomId)
          .order('created_at', { ascending: true }),
        (supabase as any)
          .from('os_business_objects')
          .select('id, room_id, object_type, source_message_id, created_by_merchant_id, state_snapshot_hash, payload, status, created_at')
          .eq('room_id', activeRoomId)
          .order('created_at', { ascending: true }),
      ]);

      if (messagesRes.error) throw messagesRes.error;
      if (objectsRes.error) throw objectsRes.error;

      const messages = (messagesRes.data || []).map((row: any) => toOsMessage(row as DbMessage));
      const objects = (objectsRes.data || []).map((row: any) => toOsBusinessObject(row as DbBusinessObject));

      return [...messages, ...objects].sort((a, b) => a.created_at.localeCompare(b.created_at));
    },
    refetchInterval: 5_000,
  });

  const activeRoom = useMemo(() => rooms.find((room) => room.id === activeRoomId) || null, [rooms, activeRoomId]);

  const sendMutation = useMutation({
    mutationFn: async (content: string) => {
      if (!activeRoom || !merchantId) return;

      const payload = {
        room_id: activeRoom.id,
        sender_merchant_id: merchantId,
        content,
        permissions: {
          forwardable: !activeRoom.security_policies.disable_forwarding,
          exportable: !activeRoom.security_policies.disable_export,
          copyable: !activeRoom.security_policies.disable_copy,
          ai_readable: true,
        },
        retention_policy: activeRoom.retention_policy,
      };

      const { error } = await (supabase as any).from('os_messages').insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['os-timeline', activeRoomId] });
    },
  });

  const convertMutation = useMutation({
    mutationFn: async (input: { messageId: string; targetType: 'task' | 'order' }) => {
      if (!activeRoom || !merchantId) return;

      const { error } = await (supabase as any).from('os_business_objects').insert({
        room_id: activeRoom.id,
        object_type: input.targetType,
        source_message_id: input.messageId,
        created_by_merchant_id: merchantId,
        payload: input.targetType === 'task' ? { description: 'Extracted task automatically' } : { default_terms: true },
        status: 'pending',
      });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['os-timeline', activeRoomId] });
    },
  });

  const acceptDealMutation = useMutation({
    mutationFn: async (dealId: string) => {
      const { error } = await (supabase as any)
        .from('os_business_objects')
        .update({ status: 'locked', state_snapshot_hash: generateSnapshotHash() })
        .eq('id', dealId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['os-timeline', activeRoomId] });
    },
  });

  const toggleLayout = () => setLayoutTheme((current) => (current === 'classic' ? 'modern' : 'classic'));

  const isCopyDisabled = activeRoom?.security_policies.disable_copy;
  const isWatermarked = activeRoom?.security_policies.disable_export || activeRoom?.security_policies.watermark;

  const watermarkBg = isWatermarked
    ? `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='300' height='300' opacity='0.03' transform='rotate(-45)'><text x='50' y='150' font-family='sans-serif' font-size='20' font-weight='bold' fill='%23000'>CONFIDENTIAL - ${merchantId || 'anonymous'}</text></svg>")`
    : 'none';

  if (!merchantId && !roomsLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '70vh' }}>
        Merchant profile is required to load messaging rooms.
      </div>
    );
  }

  if (roomsLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '70vh' }}>
        Loading secure messaging rooms...
      </div>
    );
  }

  return (
    <div style={{
      display: 'flex',
      height: 'calc(100vh - 56px)',
      overflow: 'hidden',
      background: layoutTheme === 'modern' ? '#ffffff' : '#f8f9fe',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      userSelect: isCopyDisabled ? 'none' : 'auto',
      WebkitUserSelect: isCopyDisabled ? 'none' : 'auto',
    }}>
      {layoutTheme === 'classic' ? (
        <>
          <ConversationSidebar conversations={rooms} activeRoomId={activeRoomId} onSelectRoom={setActiveRoomId} />
          {activeRoom ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', position: 'relative' }}>
              {isCopyDisabled && (
                <div style={{ background: '#ef4444', color: '#fff', fontSize: 11, fontWeight: 700, padding: '4px 16px', textAlign: 'center', flexShrink: 0 }}>
                  RESTRICTED ROOM: Copying, forwarding, and exporting are disabled by Policy.
                </div>
              )}

              <ConversationHeader
                name={activeRoom.name}
                nickname={activeRoom.type}
                onBack={() => setActiveRoomId(null)}
                onSearchToggle={() => {}}
                onCallClick={() => {}}
                onToggleLayout={toggleLayout}
              />

              <div style={{ flex: 1, position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                <div style={{ position: 'absolute', inset: 0, backgroundImage: watermarkBg, pointerEvents: 'none', zIndex: 0 }} />
                <MessageTimeline
                  messages={activeItems}
                  currentUserId={merchantId || ''}
                  counterpartyName={activeRoom.name}
                  scrollRef={() => {}}
                  onReply={() => {}}
                  onAcceptDeal={(id) => acceptDealMutation.mutate(id)}
                  onConvertMessage={(messageId, targetType) => convertMutation.mutate({ messageId, targetType })}
                  identitiesById={identitiesById}
                />
              </div>

              {miniApp && (
                <div style={{ background: '#fff', borderTop: '1px solid #e2e8f0', padding: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <strong>{miniApp === 'calculator' ? 'Calculator App' : 'Order Form'}</strong>
                    <button onClick={() => setMiniApp(null)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#ef4444' }}>Close</button>
                  </div>
                  <div style={{ background: '#f8fafc', padding: 16, borderRadius: 8, border: '1px dashed #cbd5e1', textAlign: 'center', color: '#64748b' }}>
                    [Interactive {miniApp} mini-app renders securely inside viewport]
                  </div>
                </div>
              )}

              <MessageComposer
                onSend={(content) => sendMutation.mutate(content)}
                onTyping={() => {}}
                replyTo={null}
                onCancelReply={() => {}}
                onOpenApp={(app) => setMiniApp(app as any)}
              />
            </div>
          ) : (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Select a room</div>
          )}
        </>
      ) : (
        <>
          <ModernSidebar conversations={rooms} activeRoomId={activeRoomId} onSelectRoom={setActiveRoomId} />
          {activeRoom ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', position: 'relative' }}>
              {isCopyDisabled && (
                <div style={{ background: '#ef4444', color: '#fff', fontSize: 11, fontWeight: 700, padding: '4px 16px', textAlign: 'center', flexShrink: 0 }}>
                  RESTRICTED ROOM: Actions disabled.
                </div>
              )}

              <ModernHeader
                name={activeRoom.name}
                onCallClick={() => {}}
                onToggleLayout={toggleLayout}
              />

              <div style={{ flex: 1, position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                <div style={{ position: 'absolute', inset: 0, backgroundImage: watermarkBg, pointerEvents: 'none', zIndex: 0 }} />
                <ModernTimeline
                  messages={activeItems}
                  currentUserId={merchantId || ''}
                  counterpartyName={activeRoom.name}
                  onAcceptDeal={(id) => acceptDealMutation.mutate(id)}
                  onConvertMessage={(messageId, targetType) => convertMutation.mutate({ messageId, targetType })}
                  identitiesById={identitiesById}
                />
              </div>

              {miniApp && (
                <div style={{ background: '#fff', borderTop: '1px solid #e2e8f0', padding: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <strong>{miniApp === 'calculator' ? 'Calculator App' : 'Order Form'}</strong>
                    <button onClick={() => setMiniApp(null)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#ef4444' }}>Close</button>
                  </div>
                  <div style={{ background: '#f8fafc', padding: 16, borderRadius: 8, border: '1px dashed #cbd5e1', textAlign: 'center', color: '#64748b' }}>
                    [Interactive {miniApp} mini-app renders securely inside viewport]
                  </div>
                </div>
              )}

              <ModernComposer
                onSend={(content) => sendMutation.mutate(content)}
                onOpenApp={(app) => setMiniApp(app as any)}
              />
            </div>
          ) : (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Select a room</div>
          )}
        </>
      )}
    </div>
  );
}
