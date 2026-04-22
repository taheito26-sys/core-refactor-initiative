import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/auth-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useIsMobile } from '@/hooks/use-mobile';
import { getOrCreateDirectRoom } from '@/features/chat/api/chat';
import { resolveCustomerLabel } from '@/features/merchants/lib/customer-labels';

interface Props {
  merchantId: string;
  userId?: string | null;
  isAdminView?: boolean;
}

export default function MerchantClientsTab({ merchantId, userId, isAdminView }: Props) {
  const { userId: authUserId } = useAuth();
  const resolvedUserId = isAdminView ? userId ?? null : authUserId;
  const canMutate = !isAdminView;
  const qc = useQueryClient();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [filter, setFilter] = useState<'all' | 'pending' | 'active' | 'blocked'>('all');
  const [openingChat, setOpeningChat] = useState<string | null>(null);

  const handleOpenClientChat = async (customerUserId: string, customerName: string) => {
    if (!customerUserId) return;
    setOpeningChat(customerUserId);
    try {
      const roomId = await getOrCreateDirectRoom(customerUserId, `Chat with ${customerName}`);
      navigate(`/chat?roomId=${encodeURIComponent(roomId)}`);
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message ?? 'Failed to open chat';
      toast.error(msg);
    } finally {
      setOpeningChat(null);
    }
  };

  const { data: connections = [], isLoading } = useQuery({
    queryKey: ['merchant-client-connections', merchantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('customer_merchant_connections')
        .select('id, customer_user_id, merchant_id, status, nickname, created_at, updated_at')
        .eq('merchant_id', merchantId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      if (!data || data.length === 0) return [];

      const userIds = [...new Set(data.map((c) => c.customer_user_id))];
      const { data: profiles, error: profileError } = await supabase
        .from('customer_profiles')
        .select('user_id, display_name, phone, region, country')
        .in('user_id', userIds);
      if (profileError) throw profileError;
      const profileMap = new Map((profiles ?? []).map((p: any) => [p.user_id, p]));

      return data.map((c) => ({
        ...c,
        customerName: resolveCustomerLabel({
          displayName: profileMap.get(c.customer_user_id)?.display_name ?? null,
          nickname: c.nickname,
          customerUserId: c.customer_user_id,
        }),
      }));
    },
    enabled: !!merchantId,
  });

  useEffect(() => {
    if (!merchantId) return;

    const channel = supabase
      .channel(`merchant-client-connections-${merchantId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'customer_merchant_connections',
        filter: `merchant_id=eq.${merchantId}`,
      }, () => {
        qc.invalidateQueries({ queryKey: ['merchant-client-connections', merchantId] });
        qc.invalidateQueries({ queryKey: ['merchant-client-order-counts', merchantId] });
        qc.invalidateQueries({ queryKey: ['merchant-client-unread', merchantId, resolvedUserId] });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [merchantId, qc, resolvedUserId]);

  // Orders count per connection
  const { data: orderCounts = {} } = useQuery({
    queryKey: ['merchant-client-order-counts', merchantId],
    queryFn: async () => {
      const { data } = await supabase
        .from('customer_orders')
        .select('connection_id, status')
        .eq('merchant_id', merchantId);
      if (!data) return {};
      const counts: Record<string, { total: number; pending: number }> = {};
      data.forEach((o) => {
        if (!counts[o.connection_id]) counts[o.connection_id] = { total: 0, pending: 0 };
        counts[o.connection_id].total++;
        if (['pending_quote', 'quoted', 'quote_accepted', 'awaiting_payment', 'payment_sent', 'pending'].includes(o.status)) {
          counts[o.connection_id].pending++;
        }
      });
      return counts;
    },
    enabled: !!merchantId,
  });

  // Unread counts per connection
  const { data: unreadCounts = {} } = useQuery({
    queryKey: ['merchant-client-unread', merchantId, resolvedUserId],
    queryFn: async () => {
      const { data } = await supabase
        .from('customer_messages')
        .select('connection_id')
        .eq('sender_role', 'customer')
        .is('read_at', null);
      if (!data) return {};
      const counts: Record<string, number> = {};
      data.forEach((m: any) => {
        counts[m.connection_id] = (counts[m.connection_id] || 0) + 1;
      });
      return counts;
    },
    enabled: !!resolvedUserId,
  });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase
        .from('customer_merchant_connections')
        .update({ status })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['merchant-client-connections', merchantId] });
      toast.success('Connection updated');
    },
    onError: (err: any) => toast.error(err?.message ?? 'Update failed'),
  });

  const filtered = filter === 'all' ? connections : connections.filter((c: any) => c.status === filter);
  const pendingCount = connections.filter((c: any) => c.status === 'pending').length;

  const statusPill = (status: string) => {
    const cls = status === 'active' ? 'good' : status === 'pending' ? 'warn' : status === 'blocked' ? 'bad' : '';
    return <span className={`pill ${cls}`}>{status}</span>;
  };

  // Chat now lives in the unified /chat route — no inline panel needed

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {(['all', 'pending', 'active', 'blocked'] as const).map((f) => (
          <button
            key={f}
            className="btn"
            onClick={() => setFilter(f)}
            style={{
              fontSize: 10,
              fontWeight: filter === f ? 700 : 400,
              opacity: filter === f ? 1 : 0.6,
              minHeight: 34,
              padding: '4px 12px',
            }}
          >
            {f === 'all' ? `All (${connections.length})` :
             f === 'pending' ? `⏳ Pending (${pendingCount})` :
             f === 'active' ? `✅ Active` :
             `🚫 Blocked`}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="empty">
          <div className="empty-t">Loading...</div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty">
          <div className="empty-icon">👤</div>
          <div className="empty-t">No customer connections</div>
          <div className="empty-d">Customers will appear here when they connect to your merchant profile</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {filtered.map((conn: any) => {
            const counts = orderCounts[conn.id];
            const unread = unreadCounts[conn.id] || 0;
            const resolvedName = String(conn.customerName ?? '').trim();
            const nickname = String(conn.nickname ?? '').trim();
            const nicknameLabel = nickname && nickname.toLowerCase() !== resolvedName.toLowerCase()
              ? `@${nickname}`
              : 'Connected customer';
            return (
              <div
                key={conn.id}
                className="card"
                style={{
                  padding: '10px 12px',
                  display: 'flex',
                  flexDirection: isMobile ? 'column' : 'row',
                  alignItems: isMobile ? 'stretch' : 'center',
                  gap: isMobile ? 8 : 12,
                  border: conn.status === 'pending' ? '2px solid var(--warn)' : undefined,
                }}
              >
                                {/* Customer info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{
                      width: 32, height: 32, borderRadius: '50%',
                      background: 'var(--brand)', color: '#fff',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontWeight: 700, fontSize: 13, flexShrink: 0,
                    }}>
                      {conn.customerName?.[0]?.toUpperCase() ?? '?'}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {resolvedName}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--muted)' }}>
                        {nicknameLabel}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Stats */}
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 10 }}>
                    {counts && (
                      <>
                        <div style={{ textAlign: 'center' }}>
                          <div style={{ fontWeight: 700, fontSize: 13 }}>{counts.total}</div>
                          <div style={{ color: 'var(--muted)' }}>Orders</div>
                        </div>
                        {counts.pending > 0 && (
                          <div style={{ textAlign: 'center' }}>
                            <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--warn)' }}>{counts.pending}</div>
                            <div style={{ color: 'var(--muted)' }}>Pending</div>
                          </div>
                        )}
                      </>
                    )}
                    {statusPill(conn.status)}
                  </div>

                {/* Actions */}
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <button
                    className="btn"
                    style={{ fontSize: 10, minHeight: 34, padding: '4px 12px' }}
                    onClick={() => navigate('/merchants?tab=client-orders')}
                  >
                    View Orders
                  </button>
                  {canMutate && conn.status === 'active' && (
                    <button
                      className="btn"
                      style={{
                        fontSize: 10, minHeight: 34, padding: '4px 12px',
                        position: 'relative',
                      }}
                      disabled={openingChat === conn.customer_user_id}
                      onClick={() => handleOpenClientChat(
                        conn.customer_user_id,
                        conn.customerName,
                      )}
                    >
                      💬 Chat
                      {unread > 0 && (
                        <span style={{
                          position: 'absolute', top: -4, right: -4,
                          fontSize: 9, fontWeight: 700, background: 'var(--bad)',
                          color: '#fff', borderRadius: 10, padding: '1px 5px',
                          minWidth: 14, textAlign: 'center',
                        }}>
                          {unread}
                        </span>
                      )}
                    </button>
                  )}
                  {canMutate && conn.status === 'pending' && (
                    <>
                      <button
                        className="btn"
                        style={{ fontSize: 10, minHeight: 34, padding: '4px 12px', background: 'var(--good)', color: '#fff' }}
                        onClick={() => updateStatus.mutate({ id: conn.id, status: 'active' })}
                        disabled={updateStatus.isPending}
                      >
                        ✅ Accept
                      </button>
                      <button
                        className="btn"
                        style={{ fontSize: 10, minHeight: 34, padding: '4px 12px' }}
                        onClick={() => updateStatus.mutate({ id: conn.id, status: 'blocked' })}
                        disabled={updateStatus.isPending}
                      >
                        ❌ Reject
                      </button>
                    </>
                  )}
                  {canMutate && conn.status === 'active' && (
                    <button
                      className="btn"
                      style={{ fontSize: 10, minHeight: 34, padding: '4px 12px' }}
                      onClick={() => updateStatus.mutate({ id: conn.id, status: 'blocked' })}
                      disabled={updateStatus.isPending}
                    >
                      🚫 Block
                    </button>
                  )}
                  {canMutate && conn.status === 'blocked' && (
                    <button
                      className="btn"
                      style={{ fontSize: 10, minHeight: 34, padding: '4px 12px' }}
                      onClick={() => updateStatus.mutate({ id: conn.id, status: 'active' })}
                      disabled={updateStatus.isPending}
                    >
                      🔓 Unblock
                    </button>
                  )}
                </div>

                {/* Timestamp */}
                <div style={{ fontSize: 9, color: 'var(--muted)', flexShrink: 0 }}>
                  {new Date(conn.created_at).toLocaleDateString()}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── MerchantCustomerChat removed ──────────────────────────────────────────
// Chat is now handled by the unified platform at /chat.
// Use handleOpenClientChat() → getOrCreateDirectRoom() → navigate('/chat?roomId=...')
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _MerchantCustomerChat_REMOVED({
  connectionId,
  customerName,
  userId,
  onBack,
}: {
  connectionId: string;
  customerName: string;
  userId: string;
  onBack: () => void;
}) {
  const qc = useQueryClient();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [message, setMessage] = useState('');

  // Messages
  const { data: messages = [] } = useQuery({
    queryKey: ['merchant-customer-messages', connectionId],
    queryFn: async () => {
      const { data } = await supabase
        .from('customer_messages')
        .select('*')
        .eq('connection_id', connectionId)
        .order('created_at', { ascending: true })
        .limit(300);
      return data ?? [];
    },
    enabled: !!connectionId,
  });

  // Mark messages as read
  useEffect(() => {
    if (!connectionId || messages.length === 0) return;
    const unreadIds = messages
      .filter((m: any) => m.sender_role === 'customer' && !m.read_at)
      .map((m: any) => m.id);
    if (unreadIds.length > 0) {
      supabase
        .from('customer_messages')
        .update({ read_at: new Date().toISOString() })
        .in('id', unreadIds)
        .then(() => {
          qc.invalidateQueries({ queryKey: ['merchant-client-unread'] });
        });
    }
  }, [connectionId, messages, qc]);

  // Realtime
  useEffect(() => {
    if (!connectionId) return;
    const channel = supabase
      .channel(`merchant-chat-${connectionId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'customer_messages',
        filter: `connection_id=eq.${connectionId}`,
      }, () => {
        qc.invalidateQueries({ queryKey: ['merchant-customer-messages', connectionId] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [connectionId, qc]);

  // Auto-scroll
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  const sendMessage = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('customer_messages').insert({
        connection_id: connectionId,
        sender_user_id: userId,
        sender_role: 'merchant',
        content: message.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setMessage('');
      qc.invalidateQueries({ queryKey: ['merchant-customer-messages', connectionId] });
    },
    onError: (err: any) => toast.error(err?.message ?? 'Failed to send'),
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100dvh - 14rem)' }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        paddingBottom: 10, borderBottom: '1px solid var(--line)', marginBottom: 8,
      }}>
        <button
          className="btn"
          onClick={onBack}
          style={{ fontSize: 11, minHeight: 34, padding: '4px 10px' }}
        >
          ← Back
        </button>
        <div style={{
          width: 28, height: 28, borderRadius: '50%',
          background: 'var(--brand)', color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontWeight: 700, fontSize: 11,
        }}>
          {customerName[0]?.toUpperCase() ?? 'C'}
        </div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 12 }}>{customerName}</div>
          <div style={{ fontSize: 9, color: 'var(--muted)' }}>Customer chat</div>
        </div>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        style={{
          flex: 1, overflowY: 'auto',
          display: 'flex', flexDirection: 'column', gap: 4,
          paddingBottom: 8,
        }}
      >
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 11, padding: '40px 0' }}>
            No messages yet. Start the conversation!
          </div>
        )}
        {messages.map((msg: any) => {
          const isMerchant = msg.sender_role === 'merchant';
          return (
            <div
              key={msg.id}
              style={{
                maxWidth: '80%',
                alignSelf: isMerchant ? 'flex-end' : 'flex-start',
                padding: '8px 12px',
                borderRadius: 12,
                background: isMerchant ? 'var(--brand)' : 'var(--cardBg)',
                color: isMerchant ? '#fff' : 'var(--t1)',
                border: isMerchant ? 'none' : '1px solid var(--line)',
                fontSize: 12,
              }}
            >
              <div>{msg.content}</div>
              <div style={{
                fontSize: 9,
                opacity: 0.6,
                marginTop: 2,
                textAlign: 'right',
              }}>
                {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                {isMerchant && msg.read_at && ' ✓✓'}
              </div>
            </div>
          );
        })}
      </div>

      {/* Composer */}
      <div style={{
        display: 'flex', gap: 8, paddingTop: 8,
        borderTop: '1px solid var(--line)',
      }}>
        <div className="inputBox" style={{ flex: 1, padding: '6px 10px' }}>
          <input
            placeholder="Type a message..."
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && message.trim() && sendMessage.mutate()}
            style={{ width: '100%' }}
          />
        </div>
        <button
          className="btn"
          onClick={() => message.trim() && sendMessage.mutate()}
          disabled={sendMessage.isPending || !message.trim()}
          style={{ minHeight: 38, padding: '4px 14px', fontSize: 11 }}
        >
          📨 Send
        </button>
      </div>
    </div>
  );
}
