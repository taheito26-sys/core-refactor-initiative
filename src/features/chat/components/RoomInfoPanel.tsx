// ─── RoomInfoPanel — Enhanced with Privacy Phases ────────────────────────
// Phase 2: Room watermark policy display
// Phase 18: Retention policy indicator  
// Phase 24: Encryption status banner
// Phase 13: Forwarding controls display
// Phase 19: Export controls display

import { X, Lock, ShieldCheck, Users, Image as ImageIcon, FileText, Mic2, BellOff, Archive, LogOut, Shield, Forward, Copy, Download, Eye, Timer } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ChatRoomListItem, ChatRoomType } from '../types';
import { EncryptionBanner } from './EncryptionIndicator';
import { RetentionSection } from './RetentionIndicator';

interface Props {
  room: ChatRoomListItem;
  onClose: () => void;
}

function roomTypeConfig(type: ChatRoomType) {
  switch (type) {
    case 'merchant_private': return { icon: Lock, label: 'P2P Private', color: 'text-violet-500', bg: 'bg-violet-500/10' };
    case 'merchant_client':  return { icon: ShieldCheck, label: 'Client Chat', color: 'text-blue-500', bg: 'bg-blue-500/10' };
    case 'merchant_collab':  return { icon: Users, label: 'Merchants Hub', color: 'text-emerald-500', bg: 'bg-emerald-500/10' };
  }
}

function initials(name: string | null | undefined): string {
  if (!name) return '?';
  const words = name.trim().split(/\s+/);
  return words.length >= 2 ? (words[0][0] + words[words.length - 1][0]).toUpperCase() : name.slice(0, 2).toUpperCase();
}

function PolicyBadge({ icon: Icon, label, enabled }: { icon: React.ElementType; label: string; enabled: boolean }) {
  return (
    <div className={cn(
      'flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[10px] font-semibold',
      enabled ? 'bg-primary/10 text-primary' : 'bg-muted/50 text-muted-foreground/50',
    )}>
      <Icon className="h-3 w-3" />
      {label}
      <span className={cn('ml-auto text-[9px]', enabled ? 'text-emerald-500' : 'text-muted-foreground/30')}>
        {enabled ? 'ON' : 'OFF'}
      </span>
    </div>
  );
}

export function RoomInfoPanel({ room, onClose }: Props) {
  const config = roomTypeConfig(room.room_type);
  const Icon = config.icon;
  const displayName = room.display_name ?? room.name ?? 'Room';
  const avatarUrl = room.display_avatar ?? room.avatar_url;
  const policy = room.policy;

  const encryptionMode = room.room_type === 'merchant_private' ? 'client_e2ee' as const
    : room.room_type === 'merchant_client' ? 'server_e2ee' as const
    : 'tls_only' as const;

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-50 animate-in fade-in-0 duration-150" onClick={onClose} />
      <div className="fixed right-0 top-0 bottom-0 w-80 max-w-[85vw] bg-card border-l border-border z-50 flex flex-col animate-in slide-in-from-right duration-200 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h3 className="text-sm font-bold text-foreground">Room Info</h3>
          <button onClick={onClose} className="h-8 w-8 rounded-lg hover:bg-muted flex items-center justify-center text-muted-foreground transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Profile section */}
          <div className="flex flex-col items-center py-6 px-4 border-b border-border/50">
            {avatarUrl ? (
              <img src={avatarUrl} alt={displayName} className="h-20 w-20 rounded-2xl object-cover shadow-lg" />
            ) : (
              <div className="h-20 w-20 rounded-2xl bg-primary flex items-center justify-center text-primary-foreground text-xl font-black shadow-lg shadow-primary/20">
                {initials(displayName)}
              </div>
            )}
            <h2 className="mt-3 text-base font-bold text-foreground">{displayName}</h2>
            <div className={cn('flex items-center gap-1.5 mt-1', config.color)}>
              <Icon className="h-3.5 w-3.5" />
              <span className="text-xs font-semibold">{config.label}</span>
            </div>
          </div>

          {/* Stats */}
          <div className="px-4 py-3 border-b border-border/50">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/50 mb-2">Details</p>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Members</span>
                <span className="text-xs font-semibold text-foreground">{room.member_count ?? 2}</span>
              </div>
            </div>
          </div>

          {/* Phase 24: Encryption status */}
          <EncryptionBanner mode={encryptionMode} />

          {/* Phase 18: Retention policy */}
          <RetentionSection retentionHours={policy?.retention_hours ?? null} />

          {/* Phase 2, 13, 14, 19: Security policies */}
          <div className="px-4 py-3 border-b border-border/50">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/50 mb-2">Security Policies</p>
            <div className="space-y-1.5">
              <PolicyBadge icon={Eye} label="Watermark" enabled={policy?.watermark_enabled ?? false} />
              <PolicyBadge icon={Shield} label="Screenshot protection" enabled={policy?.screenshot_protection ?? false} />
              <PolicyBadge icon={Forward} label="Forwarding allowed" enabled={true} />
              <PolicyBadge icon={Copy} label="History searchable" enabled={policy?.history_searchable ?? false} />
              <PolicyBadge icon={Timer} label="Disappearing default" enabled={!!policy?.disappearing_default_hours} />
            </div>
          </div>

          {/* Shared media */}
          <div className="px-4 py-3 border-b border-border/50">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/50 mb-2">Shared Media</p>
            <div className="grid grid-cols-3 gap-2">
              {[
                { icon: ImageIcon, label: 'Photos', count: 0 },
                { icon: FileText, label: 'Files', count: 0 },
                { icon: Mic2, label: 'Audio', count: 0 },
              ].map(({ icon: I, label, count }) => (
                <button key={label} className="flex flex-col items-center gap-1 py-3 rounded-xl hover:bg-muted/50 transition-colors">
                  <I className="h-5 w-5 text-muted-foreground/60" />
                  <span className="text-[10px] text-muted-foreground">{label}</span>
                  <span className="text-xs font-bold text-foreground">{count}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="px-4 py-3 space-y-1">
            <button className="flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-sm hover:bg-muted transition-colors text-foreground">
              <BellOff className="h-4 w-4 text-muted-foreground" />
              Mute notifications
            </button>
            <button className="flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-sm hover:bg-muted transition-colors text-foreground">
              <Archive className="h-4 w-4 text-muted-foreground" />
              Archive conversation
            </button>
            <button className="flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-sm hover:bg-muted transition-colors text-destructive">
              <LogOut className="h-4 w-4" />
              Leave room
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
