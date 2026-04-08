import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/features/auth/auth-context';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MessageCircle, Send, ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function CustomerChatPage() {
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  // Connections with merchant names
  const { data: connections = [] } = useQuery({
    queryKey: ['customer-chat-connections', userId],
    queryFn: async () => {
      const { data } = await supabase
        .from('customer_merchant_connections')
        .select('id, merchant_id, status')
        .eq('customer_user_id', userId!)
        .eq('status', 'active');
      if (!data || data.length === 0) return [];
      const mids = data.map((c: any) => c.merchant_id);
      const { data: profiles } = await supabase
        .from('merchant_profiles')
        .select('merchant_id, display_name, nickname')
        .in('merchant_id', mids);
      const pMap = new Map((profiles ?? []).map((p: any) => [p.merchant_id, p]));
      return data.map((c: any) => ({
        ...c,
        merchantName: pMap.get(c.merchant_id)?.display_name ?? c.merchant_id,
      }));
    },
    enabled: !!userId,
  });

  // Messages for selected connection
  const { data: messages = [] } = useQuery({
    queryKey: ['customer-messages', selectedConnectionId],
    queryFn: async () => {
      const { data } = await supabase
        .from('customer_messages')
        .select('*')
        .eq('connection_id', selectedConnectionId!)
        .order('created_at', { ascending: true })
        .limit(200);
      return data ?? [];
    },
    enabled: !!selectedConnectionId,
  });

  // Realtime subscription
  useEffect(() => {
    if (!selectedConnectionId) return;
    const channel = supabase
      .channel(`customer-chat-${selectedConnectionId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'customer_messages',
        filter: `connection_id=eq.${selectedConnectionId}`,
      }, () => {
        queryClient.invalidateQueries({ queryKey: ['customer-messages', selectedConnectionId] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [selectedConnectionId, queryClient]);

  // Auto-scroll
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  const sendMessage = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('customer_messages').insert({
        connection_id: selectedConnectionId!,
        sender_user_id: userId!,
        sender_role: 'customer',
        content: message.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setMessage('');
      queryClient.invalidateQueries({ queryKey: ['customer-messages', selectedConnectionId] });
    },
  });

  // Chat view
  if (selectedConnectionId) {
    const conn = connections.find((c: any) => c.id === selectedConnectionId);
    return (
      <div className="flex flex-col h-[calc(100dvh-7.5rem)]">
        <div className="flex items-center gap-2 pb-3 border-b mb-3">
          <Button variant="ghost" size="icon" onClick={() => setSelectedConnectionId(null)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <span className="font-medium">{conn?.merchantName ?? 'Chat'}</span>
        </div>
        <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-2 pb-2">
          {messages.map((msg: any) => (
            <div
              key={msg.id}
              className={cn(
                'max-w-[80%] rounded-xl px-3 py-2 text-sm',
                msg.sender_role === 'customer'
                  ? 'ml-auto bg-primary text-primary-foreground'
                  : 'mr-auto bg-muted'
              )}
            >
              {msg.content}
              <div className={cn(
                'text-[10px] mt-0.5',
                msg.sender_role === 'customer' ? 'text-primary-foreground/60' : 'text-muted-foreground'
              )}>
                {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
          ))}
        </div>
        <div className="flex gap-2 pt-3 border-t">
          <Input
            placeholder="Type a message..."
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && message.trim() && sendMessage.mutate()}
          />
          <Button size="icon" onClick={() => message.trim() && sendMessage.mutate()} disabled={sendMessage.isPending}>
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    );
  }

  // Connection list
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Chat</h1>
      {connections.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <MessageCircle className="h-12 w-12 text-muted-foreground/40 mb-3" />
            <p className="text-muted-foreground">No conversations yet</p>
            <p className="text-sm text-muted-foreground mt-1">Connect to a merchant to start chatting</p>
          </CardContent>
        </Card>
      ) : (
        connections.map((conn: any) => (
          <Card
            key={conn.id}
            className="cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => setSelectedConnectionId(conn.id)}
          >
            <CardContent className="flex items-center gap-3 py-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary font-bold">
                {conn.merchantName?.[0]?.toUpperCase() ?? 'M'}
              </div>
              <div>
                <p className="font-medium">{conn.merchantName}</p>
                <p className="text-sm text-muted-foreground">Tap to chat</p>
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
