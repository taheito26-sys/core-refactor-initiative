import { useState } from 'react';
import { Send, Megaphone, Loader2, User, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useAdminUsers } from '../hooks/useAdminUsers';

const CATEGORIES = [
  { value: 'system', label: 'System', color: 'bg-muted text-muted-foreground' },
  { value: 'deal', label: 'Deal', color: 'bg-accent/10 text-accent' },
  { value: 'order', label: 'Order', color: 'bg-warning/10 text-warning' },
  { value: 'approval', label: 'Approval', color: 'bg-success/10 text-success' },
];

export function AdminNotificationSender() {
  const { toast } = useToast();
  const { data: users } = useAdminUsers();
  const [mode, setMode] = useState<'individual' | 'broadcast'>('individual');
  const [targetUserId, setTargetUserId] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [category, setCategory] = useState('system');
  const [sending, setSending] = useState(false);
  const [userSearch, setUserSearch] = useState('');

  const filteredUsers = (users ?? []).filter(u => {
    if (!userSearch.trim()) return true;
    const q = userSearch.toLowerCase();
    return u.email.toLowerCase().includes(q) || u.display_name?.toLowerCase().includes(q) || u.user_id.includes(q);
  });

  const selectedUser = users?.find(u => u.user_id === targetUserId);

  const handleSend = async () => {
    if (!title.trim()) return;
    setSending(true);
    try {
      if (mode === 'broadcast') {
        const { data, error } = await supabase.rpc('admin_broadcast_notification' as any, {
          _title: title.trim(),
          _body: body.trim() || null,
          _category: category,
        });
        if (error) throw error;
        toast({ title: 'Broadcast sent', description: `Notification sent to ${data} users.` });
      } else {
        if (!targetUserId) {
          toast({ title: 'Select a user', variant: 'destructive' });
          setSending(false);
          return;
        }
        const { error } = await supabase.from('notifications').insert({
          user_id: targetUserId,
          title: title.trim(),
          body: body.trim() || null,
          category,
        });
        if (error) throw error;

        // Audit log
        await supabase.from('admin_audit_logs').insert({
          admin_user_id: (await supabase.auth.getUser()).data.user!.id,
          action: 'send_notification',
          target_type: 'notification',
          target_id: targetUserId,
          details: { title: title.trim(), body: body.trim(), category, target_user_id: targetUserId },
        });

        toast({ title: 'Notification sent', description: `Sent to ${selectedUser?.email ?? targetUserId.slice(0, 8)}` });
      }
      setTitle('');
      setBody('');
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold text-foreground">Send Notifications</h2>
      </div>

      <div className="flex gap-2">
        <Button
          variant={mode === 'individual' ? 'default' : 'outline'}
          size="sm"
          className="text-xs gap-1"
          onClick={() => setMode('individual')}
        >
          <User className="h-3 w-3" /> Individual
        </Button>
        <Button
          variant={mode === 'broadcast' ? 'default' : 'outline'}
          size="sm"
          className="text-xs gap-1"
          onClick={() => setMode('broadcast')}
        >
          <Users className="h-3 w-3" /> Broadcast All
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            {mode === 'broadcast' ? (
              <><Megaphone className="h-4 w-4 text-warning" /> Broadcast to All Approved Users</>
            ) : (
              <><Send className="h-4 w-4 text-primary" /> Send to Individual User</>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {mode === 'individual' && (
            <div className="space-y-2">
              <Label className="text-xs">Recipient</Label>
              {selectedUser ? (
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-xs">
                    {selectedUser.display_name ?? selectedUser.email}
                  </Badge>
                  <Button variant="ghost" size="sm" className="h-6 text-[10px]" onClick={() => setTargetUserId('')}>
                    Change
                  </Button>
                </div>
              ) : (
                <div className="space-y-1">
                  <Input
                    placeholder="Search users…"
                    value={userSearch}
                    onChange={e => setUserSearch(e.target.value)}
                    className="h-8 text-sm"
                  />
                  {userSearch.trim() && (
                    <div className="border rounded-md max-h-32 overflow-y-auto">
                      {filteredUsers.slice(0, 10).map(u => (
                        <button
                          key={u.user_id}
                          className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted/50 flex justify-between"
                          onClick={() => { setTargetUserId(u.user_id); setUserSearch(''); }}
                        >
                          <span className="font-medium">{u.display_name ?? u.email}</span>
                          <span className="text-muted-foreground">{u.email}</span>
                        </button>
                      ))}
                      {filteredUsers.length === 0 && (
                        <p className="text-xs text-muted-foreground p-2 text-center">No users found</p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map(c => (
                    <SelectItem key={c.value} value={c.value} className="text-xs">
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Title *</Label>
              <Input value={title} onChange={e => setTitle(e.target.value)} className="h-8 text-sm" placeholder="Notification title" />
            </div>
          </div>

          <div>
            <Label className="text-xs">Body (optional)</Label>
            <Textarea value={body} onChange={e => setBody(e.target.value)} className="text-sm min-h-[60px]" placeholder="Additional details…" />
          </div>

          <div className="flex items-center justify-between pt-1">
            {mode === 'broadcast' && (
              <p className="text-[10px] text-warning">⚠ This will notify all approved users</p>
            )}
            <Button
              size="sm"
              className="ml-auto gap-1"
              onClick={handleSend}
              disabled={sending || !title.trim() || (mode === 'individual' && !targetUserId)}
            >
              {sending ? <Loader2 className="h-3 w-3 animate-spin" /> : mode === 'broadcast' ? <Megaphone className="h-3 w-3" /> : <Send className="h-3 w-3" />}
              {mode === 'broadcast' ? 'Broadcast' : 'Send'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
