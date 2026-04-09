// ─── NewChatModal — Start a new conversation with a merchant ──────────────
import { useState, useEffect } from 'react';
import { X, Search, Users, Lock, Briefcase, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { getOrCreateDirectRoom } from '../api/chat';
import { cn } from '@/lib/utils';

interface MerchantEntry {
  user_id: string;
  display_name: string;
  merchant_id: string;
  avatar_url?: string | null;
}

interface Props {
  meId: string;
  onSelectRoom: (roomId: string) => void;
  onClose: () => void;
}

function avatarGradient(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
  const h1 = Math.abs(hash % 360);
  const h2 = (h1 + 40) % 360;
  return `linear-gradient(135deg, hsl(${h1} 65% 55%), hsl(${h2} 60% 45%))`;
}

export function NewChatModal({ meId, onSelectRoom, onClose }: Props) {
  const [search, setSearch] = useState('');
  const [merchants, setMerchants] = useState<MerchantEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('profiles')
        .select('user_id, display_name, merchant_id, avatar_url')
        .neq('user_id', meId)
        .not('merchant_id', 'is', null)
        .order('display_name');
      if (!error && data) {
        setMerchants(data as MerchantEntry[]);
      }
      setLoading(false);
    })();
  }, [meId]);

  const filtered = search.trim()
    ? merchants.filter(
        (m) =>
          m.display_name.toLowerCase().includes(search.toLowerCase()) ||
          m.merchant_id.toLowerCase().includes(search.toLowerCase()),
      )
    : merchants;

  const handleSelect = async (m: MerchantEntry) => {
    setCreating(m.user_id);
    try {
      const roomId = await getOrCreateDirectRoom(m.user_id, m.display_name);
      onSelectRoom(roomId);
      onClose();
    } catch (err) {
      console.error('[NewChatModal]', err);
    } finally {
      setCreating(null);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-x-4 top-[10%] z-50 max-w-md mx-auto bg-card border border-border rounded-2xl shadow-2xl overflow-hidden animate-in fade-in-0 zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
          <h3 className="text-sm font-bold text-foreground">New Conversation</h3>
          <button onClick={onClose} className="h-7 w-7 rounded-full flex items-center justify-center hover:bg-muted transition-colors">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        {/* Search */}
        <div className="px-4 py-2 border-b border-border/30">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search merchants by name or ID..."
              autoFocus
              className="w-full pl-8 pr-3 py-2 text-xs rounded-lg bg-muted/50 border border-border/30 focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder:text-muted-foreground/40"
            />
          </div>
        </div>

        {/* List */}
        <div className="max-h-[50vh] overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 text-muted-foreground animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
              <Users className="h-8 w-8 opacity-30" />
              <p className="text-xs font-medium">
                {search ? 'No merchants found' : 'No merchants available'}
              </p>
            </div>
          ) : (
            filtered.map((m) => (
              <button
                key={m.user_id}
                onClick={() => handleSelect(m)}
                disabled={creating === m.user_id}
                className={cn(
                  'w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/50 transition-colors border-b border-border/10',
                  creating === m.user_id && 'opacity-60',
                )}
              >
                {m.avatar_url ? (
                  <img src={m.avatar_url} alt={m.display_name} className="h-10 w-10 rounded-full object-cover" />
                ) : (
                  <div
                    className="h-10 w-10 rounded-full flex items-center justify-center text-[11px] font-bold text-white shrink-0"
                    style={{ background: avatarGradient(m.user_id) }}
                  >
                    {m.display_name.slice(0, 2).toUpperCase()}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-foreground truncate">{m.display_name}</p>
                  <p className="text-[10px] text-muted-foreground/60">ID: {m.merchant_id}</p>
                </div>
                {creating === m.user_id && (
                  <Loader2 className="h-4 w-4 text-primary animate-spin shrink-0" />
                )}
              </button>
            ))
          )}
        </div>
      </div>
    </>
  );
}
