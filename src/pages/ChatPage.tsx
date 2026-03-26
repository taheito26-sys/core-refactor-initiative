import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { Shield, MapPin, PhoneCall, Vault, Calculator, CalendarClock, Scale, ShoppingCart } from 'lucide-react';
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

type MiniApp = 'calculator' | 'order_form' | 'balance_checker' | 'schedule_tool';

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

type TrustMetric = {
  merchant_id: string;
  trust_score: number;
  factors: Array<{ name: string; value: number }>;
};

type VaultItem = {
  id: string;
  item_type: string;
  title: string;
  expires_at: string | null;
  legal_hold: boolean;
};

type LocationShare = {
  id: string;
  location_mode: 'one_time' | 'live' | 'arrival_confirmation';
  lat: number;
  lng: number;
  expires_at: string | null;
  created_at: string;
};

type CallSession = {
  id: string;
  call_type: 'voice' | 'video';
  recording_restricted: boolean;
  identity_masking_enabled: boolean;
  started_at: string;
  ended_at: string | null;
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

function prettyAppLabel(app: MiniApp): string {
  if (app === 'calculator') return 'Calculator';
  if (app === 'order_form') return 'Order Form';
  if (app === 'balance_checker') return 'Balance Checker';
  return 'Schedule Tool';
}

function prettyRemaining(expiresAt: string | null): string {
  if (!expiresAt) return 'No expiry';
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return 'Expired';
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m left`;
  const hours = Math.floor(mins / 60);
  return `${hours}h left`;
}

export default function ChatPage() {
  const { merchantProfile } = useAuth();
  const merchantId = merchantProfile?.merchant_id ?? null;
  const location = useLocation();
  const queryClient = useQueryClient();

  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [layoutTheme, setLayoutTheme] = useState<'classic' | 'modern'>('modern');
  const [miniApp, setMiniApp] = useState<MiniApp | null>(null);
  const [appPayload, setAppPayload] = useState<Record<string, unknown> | null>(null);

  const roomFocusRef = useRef(true);
  const timelineRef = useRef<HTMLDivElement | null>(null);

  const setTimelineRef = useCallback((el: HTMLDivElement | null) => {
    timelineRef.current = el;
  }, []);

  const toggleLayout = useCallback(() => {
    setLayoutTheme((current) => (current === 'classic' ? 'modern' : 'classic'));
  }, []);

  useEffect(() => {
    const handleFocus = () => { roomFocusRef.current = true; };
    const handleBlur = () => { roomFocusRef.current = false; };
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'l') {
        event.preventDefault();
        toggleLayout();
      }
      if (event.ctrlKey && event.key === '/') {
        event.preventDefault();
        const composer = document.querySelector('textarea[data-chat-composer="true"]') as HTMLTextAreaElement | null;
        composer?.focus();
      }
    };

    window.addEventListener('focus', handleFocus);
    window.addEventListener('blur', handleBlur);
    window.addEventListener('keydown', handleKeydown);
    return () => {
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('keydown', handleKeydown);
    };
  }, [toggleLayout]);

  useEffect(() => {
    if (!activeRoomId) return;

    const pushPresence = (isFocused: boolean) => {
      supabase.rpc('os_record_presence', { _room_id: activeRoomId, _is_focused: isFocused } as any)
        .then(() => queryClient.invalidateQueries({ queryKey: ['os-unread-counts', merchantId] }))
        .catch(() => {});
    };

    pushPresence(document.hasFocus());

    const onFocus = () => pushPresence(true);
    const onBlur = () => pushPresence(false);
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);

    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', onBlur);
      pushPresence(false);
    };
  }, [activeRoomId, merchantId, queryClient]);

  const { data: rooms = [], isLoading: roomsLoading } = useQuery({
    queryKey: ['os-rooms', merchantId],
    enabled: !!merchantId,
    queryFn: async (): Promise<OsRoom[]> => {
      const { data, error } = await supabase
        .from('os_room_members')
        .select('room_id, os_rooms(*)')
        .eq('merchant_id', merchantId);

      if (error) throw error;

      return (data || [])
        .map((row: any) => row.os_rooms as DbRoom | null)
        .filter((room): room is DbRoom => Boolean(room))
        .map((room) => ({
          id: room.id,
          name: room.name,
          type: room.type,
          lane: room.lane,
          security_policies: room.security_policies,
          retention_policy: room.retention_policy,
        }));
    },
    staleTime: 15_000,
  });

  const { data: unreadCounts = {} } = useQuery({
    queryKey: ['os-unread-counts', merchantId],
    enabled: !!merchantId,
    queryFn: async (): Promise<Record<string, number>> => {
      const { data, error } = await supabase.rpc('os_get_unread_counts', { _merchant_id: merchantId } as any);
      if (error) throw error;
      const counts: Record<string, number> = {};
      for (const row of (data || []) as Array<{ room_id: string; unread_count: number }>) counts[row.room_id] = row.unread_count;
      return counts;
    },
    refetchInterval: 5000,
  });

  useEffect(() => {
    if (!activeRoomId && rooms.length > 0) setActiveRoomId(rooms[0].id);
  }, [activeRoomId, rooms]);

  useEffect(() => {
    if (rooms.length === 0) return;
    const params = new URLSearchParams(location.search);
    const roomParam = params.get('room_id') || params.get('conversation_id');
    if (roomParam && rooms.some((room) => room.id === roomParam)) setActiveRoomId(roomParam);
  }, [location.search, rooms]);

  const { data: identitiesById = {} } = useQuery({
    queryKey: ['os-identities', rooms.map((r) => r.id).join('|')],
    enabled: rooms.length > 0,
    queryFn: async (): Promise<Record<string, ChannelIdentity>> => {
      const roomIds = rooms.map((r) => r.id);
      const membersRes = await supabase.from('os_room_members').select('merchant_id').in('room_id', roomIds);
      if (membersRes.error) throw membersRes.error;
      const merchantIds = Array.from(new Set((membersRes.data || []).map((m: any) => m.merchant_id).filter(Boolean)));
      if (merchantIds.length === 0) return {};

      const identitiesRes = await supabase
        .from('os_channel_identities')
        .select('id, provider_type, provider_uid, confidence_level')
        .in('merchant_id', merchantIds);
      if (identitiesRes.error) throw identitiesRes.error;

      const out: Record<string, ChannelIdentity> = {};
      for (const row of identitiesRes.data || []) {
        out[row.id] = {
          id: row.id,
          provider_type: row.provider_type,
          provider_uid: row.provider_uid,
          confidence_level: row.confidence_level,
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
        supabase
          .from('os_messages')
          .select('id, room_id, thread_id, sender_merchant_id, sender_identity_id, content, permissions, expires_at, retention_policy, view_limit, read_at, created_at')
          .eq('room_id', activeRoomId)
          .is('deleted_at', null)
          .order('created_at', { ascending: true }),
        supabase
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
    refetchInterval: 5000,
  });

  const { data: trustMetric } = useQuery({
    queryKey: ['os-trust', merchantId],
    enabled: !!merchantId,
    queryFn: async (): Promise<TrustMetric | null> => {
      const rpc = await supabase.rpc('os_compute_trust_score', { _merchant_id: merchantId } as any);
      if (rpc.error) throw rpc.error;
      const first = ((rpc.data || []) as TrustMetric[])[0];
      return first || null;
    },
    refetchInterval: 15000,
  });

  const { data: vaultItems = [] } = useQuery({
    queryKey: ['os-vault-items', activeRoomId],
    enabled: !!activeRoomId,
    queryFn: async (): Promise<VaultItem[]> => {
      const res = await supabase
        .from('os_vault_items')
        .select('id, item_type, title, expires_at, legal_hold')
        .eq('room_id', activeRoomId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(10);
      if (res.error) throw res.error;
      return (res.data || []) as VaultItem[];
    },
    refetchInterval: 15000,
  });

  const { data: locationShares = [] } = useQuery({
    queryKey: ['os-location-shares', activeRoomId],
    enabled: !!activeRoomId,
    queryFn: async (): Promise<LocationShare[]> => {
      const res = await supabase
        .from('os_location_shares')
        .select('id, location_mode, lat, lng, expires_at, created_at')
        .eq('room_id', activeRoomId)
        .order('created_at', { ascending: false })
        .limit(5);
      if (res.error) throw res.error;
      return (res.data || []) as LocationShare[];
    },
    refetchInterval: 10000,
  });

  const { data: callSessions = [] } = useQuery({
    queryKey: ['os-call-sessions', activeRoomId],
    enabled: !!activeRoomId,
    queryFn: async (): Promise<CallSession[]> => {
      const res = await supabase
        .from('os_call_sessions')
        .select('id, call_type, recording_restricted, identity_masking_enabled, started_at, ended_at')
        .eq('room_id', activeRoomId)
        .order('started_at', { ascending: false })
        .limit(5);
      if (res.error) throw res.error;
      return (res.data || []) as CallSession[];
    },
    refetchInterval: 10000,
  });

  const markReadMutation = useMutation({
    mutationFn: async (roomId: string) => {
      const { error } = await supabase.rpc('os_mark_room_read', { _room_id: roomId } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['os-unread-counts', merchantId] });
      queryClient.invalidateQueries({ queryKey: ['os-timeline', activeRoomId] });
    },
  });

  useEffect(() => {
    if (!activeRoomId || !merchantId || !roomFocusRef.current) return;
    const hasUnread = activeItems.some((item) => item.type === 'message' && item.sender_id !== merchantId && !item.read_at);
    if (hasUnread) markReadMutation.mutate(activeRoomId);
  }, [activeRoomId, activeItems, merchantId, markReadMutation]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const targetMessageId = params.get('message_id') || params.get('anchor_id');
    if (!targetMessageId || !timelineRef.current) return;

    const attemptScroll = () => {
      const el = timelineRef.current?.querySelector(`[data-msg-id="${targetMessageId}"]`) as HTMLElement | null;
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };

    attemptScroll();
    const t = setTimeout(attemptScroll, 300);
    return () => clearTimeout(t);
  }, [location.search, activeItems]);

  const activeRoom = useMemo(() => rooms.find((room) => room.id === activeRoomId) || null, [rooms, activeRoomId]);

  const sendMutation = useMutation({
    mutationFn: async (content: string) => {
      if (!activeRoom) return;
      const isVanish = content.startsWith('||VANISH||');

      const { error } = await supabase.rpc('os_create_message', {
        _room_id: activeRoom.id,
        _content: content,
        _permissions: null,
        _retention_policy: activeRoom.retention_policy,
        _expires_at: isVanish ? new Date(Date.now() + 5000).toISOString() : null,
        _view_limit: isVanish ? 1 : null,
      } as any);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['os-timeline', activeRoomId] });
      queryClient.invalidateQueries({ queryKey: ['os-unread-counts', merchantId] });
    },
  });

  const convertMutation = useMutation({
    mutationFn: async (input: { messageId: string; targetType: 'task' | 'order' }) => {
      const rpc = await supabase.rpc('os_convert_message', {
        _message_id: input.messageId,
        _target_type: input.targetType,
        _payload: input.targetType === 'task' ? { description: 'Extracted task automatically' } : { default_terms: true },
      } as any);
      if (rpc.error) throw rpc.error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['os-timeline', activeRoomId] }),
  });

  const acceptDealMutation = useMutation({
    mutationFn: async (dealId: string) => {
      const rpc = await supabase.rpc('os_accept_negotiation_terms', {
        _business_object_id: dealId,
        _trigger_event: 'deal_accepted',
      } as any);
      if (rpc.error) throw rpc.error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['os-timeline', activeRoomId] }),
  });

  const openMiniApp = useCallback(async (app: MiniApp) => {
    if (!activeRoomId) return;
    const rpc = await supabase.rpc('os_validate_mini_app_intent', {
      _room_id: activeRoomId,
      _app_name: app,
      _payload: { requested_by: merchantId, requested_at: new Date().toISOString() },
    } as any);
    if (!rpc.error) {
      setAppPayload((rpc.data as Record<string, unknown>) || null);
    } else {
      setAppPayload(null);
    }
    setMiniApp(app);
  }, [activeRoomId, merchantId]);

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
        <ConversationSidebar conversations={rooms} activeRoomId={activeRoomId} onSelectRoom={setActiveRoomId} unreadCounts={unreadCounts} />
      ) : (
        <ModernSidebar conversations={rooms} activeRoomId={activeRoomId} onSelectRoom={setActiveRoomId} unreadCounts={unreadCounts} />
      )}

      {activeRoom ? (
        <div style={{ flex: 1, display: 'flex', minWidth: 0 }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', position: 'relative' }}>
            {isCopyDisabled && (
              <div style={{ background: '#ef4444', color: '#fff', fontSize: 11, fontWeight: 700, padding: '4px 16px', textAlign: 'center', flexShrink: 0 }}>
                RESTRICTED ROOM: Copying, forwarding, exporting, and screenshots are policy-restricted where supported.
              </div>
            )}

            {layoutTheme === 'classic' ? (
              <ConversationHeader
                name={activeRoom.name}
                nickname={activeRoom.type}
                onBack={() => setActiveRoomId(null)}
                onSearchToggle={() => {}}
                onCallClick={() => {}}
                onToggleLayout={toggleLayout}
              />
            ) : (
              <ModernHeader
                name={activeRoom.name}
                onCallClick={() => {}}
                onToggleLayout={toggleLayout}
              />
            )}

            <div style={{ flex: 1, position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <div style={{ position: 'absolute', inset: 0, backgroundImage: watermarkBg, pointerEvents: 'none', zIndex: 0 }} />

              {layoutTheme === 'classic' ? (
                <MessageTimeline
                  messages={activeItems}
                  currentUserId={merchantId || ''}
                  counterpartyName={activeRoom.name}
                  scrollRef={setTimelineRef}
                  onReply={() => {}}
                  onAcceptDeal={(id) => acceptDealMutation.mutate(id)}
                  onConvertMessage={(messageId, targetType) => convertMutation.mutate({ messageId, targetType })}
                  identitiesById={identitiesById}
                />
              ) : (
                <ModernTimeline
                  messages={activeItems}
                  currentUserId={merchantId || ''}
                  counterpartyName={activeRoom.name}
                  onAcceptDeal={(id) => acceptDealMutation.mutate(id)}
                  onConvertMessage={(messageId, targetType) => convertMutation.mutate({ messageId, targetType })}
                  identitiesById={identitiesById}
                  scrollRef={setTimelineRef}
                />
              )}
            </div>

            {miniApp && (
              <div style={{ background: '#fff', borderTop: '1px solid #e2e8f0', padding: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <strong>{prettyAppLabel(miniApp)}</strong>
                  <button onClick={() => { setMiniApp(null); setAppPayload(null); }} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#ef4444' }}>Close</button>
                </div>
                <div style={{ background: '#f8fafc', padding: 16, borderRadius: 8, border: '1px dashed #cbd5e1', color: '#475569', fontSize: 13 }}>
                  <div style={{ marginBottom: 6 }}>[Inline mini-app validated by backend]</div>
                  <pre style={{ margin: 0, overflowX: 'auto', fontSize: 11 }}>{JSON.stringify(appPayload, null, 2)}</pre>
                </div>
              </div>
            )}

            {layoutTheme === 'classic' ? (
              <MessageComposer onSend={(content) => sendMutation.mutate(content)} onTyping={() => {}} replyTo={null} onCancelReply={() => {}} onOpenApp={openMiniApp} />
            ) : (
              <ModernComposer onSend={(content) => sendMutation.mutate(content)} onOpenApp={openMiniApp} />
            )}
          </div>

          <aside style={{ width: 320, borderLeft: '1px solid #e5e7eb', background: '#fff', overflowY: 'auto', flexShrink: 0 }}>
            <div style={{ padding: 16, borderBottom: '1px solid #e5e7eb' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: 8 }}>Trust Layer</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <Shield size={16} color="#2563eb" />
                <strong style={{ fontSize: 20 }}>{trustMetric?.trust_score ?? 0}</strong>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {(trustMetric?.factors || []).map((factor) => (
                  <div key={factor.name} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                    <span style={{ color: '#475569' }}>{factor.name.replace('_', ' ')}</span>
                    <span style={{ fontWeight: 700 }}>{factor.value}</span>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ padding: 16, borderBottom: '1px solid #e5e7eb' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: 8 }}>Vault</div>
              {vaultItems.length === 0 ? <div style={{ fontSize: 12, color: '#94a3b8' }}>No active vault items</div> : vaultItems.map((item) => (
                <div key={item.id} style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 10, marginBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <Vault size={14} />
                    <strong style={{ fontSize: 12 }}>{item.title}</strong>
                  </div>
                  <div style={{ fontSize: 11, color: '#64748b' }}>{item.item_type} • {prettyRemaining(item.expires_at)}</div>
                  {item.legal_hold && <div style={{ fontSize: 10, color: '#dc2626', marginTop: 4 }}>Legal hold active</div>}
                </div>
              ))}
            </div>

            <div style={{ padding: 16, borderBottom: '1px solid #e5e7eb' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: 8 }}>Location Shares</div>
              {locationShares.length === 0 ? <div style={{ fontSize: 12, color: '#94a3b8' }}>No recent location shares</div> : locationShares.map((loc) => (
                <div key={loc.id} style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 10, marginBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <MapPin size={14} />
                    <strong style={{ fontSize: 12 }}>{loc.location_mode.replace('_', ' ')}</strong>
                  </div>
                  <div style={{ fontSize: 11, color: '#64748b' }}>{loc.lat.toFixed(4)}, {loc.lng.toFixed(4)}</div>
                  <div style={{ fontSize: 11, color: '#64748b' }}>{prettyRemaining(loc.expires_at)}</div>
                </div>
              ))}
            </div>

            <div style={{ padding: 16, borderBottom: '1px solid #e5e7eb' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: 8 }}>Voice / Video Metadata</div>
              {callSessions.length === 0 ? <div style={{ fontSize: 12, color: '#94a3b8' }}>No recent call sessions</div> : callSessions.map((call) => (
                <div key={call.id} style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 10, marginBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <PhoneCall size={14} />
                    <strong style={{ fontSize: 12 }}>{call.call_type.toUpperCase()} call</strong>
                  </div>
                  <div style={{ fontSize: 11, color: '#64748b' }}>Recording: {call.recording_restricted ? 'Restricted' : 'Allowed'}</div>
                  <div style={{ fontSize: 11, color: '#64748b' }}>Identity masking: {call.identity_masking_enabled ? 'On' : 'Off'}</div>
                </div>
              ))}
            </div>

            <div style={{ padding: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: 8 }}>Mini Apps</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <button onClick={() => openMiniApp('calculator')} style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 8, background: '#fff', cursor: 'pointer', fontSize: 12 }}><Calculator size={14} /> Calculator</button>
                <button onClick={() => openMiniApp('order_form')} style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 8, background: '#fff', cursor: 'pointer', fontSize: 12 }}><ShoppingCart size={14} /> Order</button>
                <button onClick={() => openMiniApp('balance_checker')} style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 8, background: '#fff', cursor: 'pointer', fontSize: 12 }}><Scale size={14} /> Balance</button>
                <button onClick={() => openMiniApp('schedule_tool')} style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 8, background: '#fff', cursor: 'pointer', fontSize: 12 }}><CalendarClock size={14} /> Schedule</button>
              </div>
            </div>
          </aside>
        </div>
      ) : (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Select a room</div>
      )}
    </div>
  );
}
