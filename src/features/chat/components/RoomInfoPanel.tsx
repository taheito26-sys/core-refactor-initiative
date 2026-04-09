// ─── RoomInfoPanel — Enhanced with Privacy Phases ────────────────────────
// Phase 2: Room watermark policy display
// Phase 18: Retention policy indicator  
// Phase 24: Encryption status banner
// Phase 13: Forwarding controls display
// Phase 19: Export controls display

import { useState, useCallback } from 'react';
import { X, Lock, ShieldCheck, Users, Image as ImageIcon, FileText, Mic2, BellOff, Archive, LogOut, Shield, Forward, Copy, Download, Eye, Timer, Phone, Link2, Droplets } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ChatRoomListItem, ChatRoomType, ChatRoomPolicy } from '../types';
import { EncryptionBanner } from './EncryptionIndicator';
import { RetentionSection } from './RetentionIndicator';
import { resolveRoomAvatar, resolveRoomDisplayName } from '../lib/identity';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { exportRoomTranscript, getRoomMembers, updateRoomPolicy, getRoomOnlineCount } from '../api/chat';
import { ROOMS_KEY } from '../hooks/useRooms';
import { toast } from 'sonner';
import { useAuth } from '@/features/auth/auth-context';
import { logPrivacyEvent } from '../lib/privacy-engine';

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

function PolicyBadge({ icon: Icon, label, enabled, onToggle }: { icon: React.ElementType; label: string; enabled: boolean; onToggle?: () => void }) {
  return (
    <button
      onClick={onToggle}
      disabled={!onToggle}
      className={cn(
        'flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[10px] font-semibold w-full transition-colors',
        enabled ? 'bg-primary/10 text-primary' : 'bg-muted/50 text-muted-foreground/50',
        onToggle && 'hover:bg-accent cursor-pointer',
        !onToggle && 'cursor-default',
      )}>
      <Icon className="h-3 w-3" />
      {label}
      <span className={cn('ml-auto text-[9px]', enabled ? 'text-emerald-500' : 'text-muted-foreground/30')}>
        {enabled ? 'ON' : 'OFF'}
      </span>
    </button>
  );
}

export function RoomInfoPanel({ room, onClose }: Props) {
  const { userId, merchantProfile } = useAuth();
  const qc = useQueryClient();
  const config = roomTypeConfig(room.room_type);
  const Icon = config.icon;
  const displayName = resolveRoomDisplayName(room);
  const avatarUrl = resolveRoomAvatar(room);
  const [localPolicy, setLocalPolicy] = useState<Partial<ChatRoomPolicy>>(room.policy ?? {});
  const policy = { ...room.policy, ...localPolicy } as ChatRoomPolicy | undefined;
  const [updatingKey, setUpdatingKey] = useState<string | null>(null);

  const membersQuery = useQuery({
    queryKey: ['chat', 'room-members', room.room_id],
    queryFn: () => getRoomMembers(room.room_id),
    staleTime: 30_000,
  });
  const members = membersQuery.data ?? [];

  // Online count
  const onlineQuery = useQuery({
    queryKey: ['chat', 'online-count', room.room_id],
    queryFn: () => getRoomOnlineCount(room.room_id),
    enabled: !room.is_direct,
    staleTime: 30_000,
  });
  const onlineCount = onlineQuery.data ?? 0;

  // Check if current user is owner or admin
  const myMembership = members.find(m => m.user_id === userId);
  const isRoomAdmin = myMembership?.role === 'owner' || myMembership?.role === 'admin';

  const exportAllowed = !(policy?.disable_export ?? false);

  const encryptionMode = room.room_type === 'merchant_private' ? 'client_e2ee' as const
    : room.room_type === 'merchant_client' ? 'server_e2ee' as const
    : 'tls_only' as const;

  const handleTogglePolicy = useCallback(async (key: string, currentValue: boolean) => {
    if (!isRoomAdmin) return;
    setUpdatingKey(key);
    try {
      await updateRoomPolicy(room.room_id, { [key]: !currentValue });
      setLocalPolicy(prev => ({ ...prev, [key]: !currentValue }));
      qc.invalidateQueries({ queryKey: ROOMS_KEY });
      toast.success(`${key.replace(/_/g, ' ')} ${!currentValue ? 'enabled' : 'disabled'}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update policy');
    } finally {
      setUpdatingKey(null);
    }
  }, [isRoomAdmin, room.room_id, qc]);

  const handleExportTranscript = async () => {
    if (!exportAllowed) {
      toast.error('Export is disabled for this room');
      return;
    }

    try {
      const transcript = await exportRoomTranscript(room.room_id);
      const lines = transcript.map((entry) => {
        const ts = new Date(entry.created_at).toISOString();
        const sender = entry.sender_name || entry.sender_id.slice(0, 8);
        const body = entry.content?.trim() || `[${entry.type}]`;
        return `[${ts}] ${sender}: ${body}`;
      });

      const header = [
        `Room: ${displayName}`,
        `Exported: ${new Date().toISOString()}`,
        `Exported By: ${merchantProfile?.merchant_id || userId?.slice(0, 8) || 'unknown'}`,
        `Messages: ${transcript.length}`,
        `Forwarding Allowed: ${policy?.disable_forwarding ? 'no' : 'yes'}`,
        `Export Allowed: ${exportAllowed ? 'yes' : 'no'}`,
        `Strip Sender On Forward: ${policy?.strip_forward_sender_identity ? 'yes' : 'no'}`,
        `Retention Hours: ${policy?.retention_hours ?? 'indefinite'}`,
        '',
      ].join('\n');

      const blob = new Blob([`${header}${lines.join('\n')}\n`], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const safeName = displayName.replace(/[^a-z0-9-_]+/gi, '_').replace(/^_+|_+$/g, '') || 'chat_room';
      a.href = url;
      a.download = `${safeName}_transcript.txt`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      void logPrivacyEvent(userId ?? '', 'room_transcript_exported', room.room_id, {
        room_name: displayName,
        message_count: transcript.length,
      });
      toast.success('Transcript exported');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to export transcript';
      toast.error(message);
    }
  };

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
                <span className="text-xs font-semibold text-foreground">{members.length || room.member_count || 0}</span>
              </div>
            </div>
          </div>

          <div className="px-4 py-3 border-b border-border/50">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/50">Members</p>
              {membersQuery.isLoading && (
                <span className="text-[10px] text-muted-foreground">Loading...</span>
              )}
            </div>
            <div className="space-y-2">
              {members.length === 0 && !membersQuery.isLoading ? (
                <p className="text-xs text-muted-foreground">No visible members</p>
              ) : (
                members.slice(0, 8).map((member) => (
                  <div key={member.id} className="flex items-center gap-3">
                    {member.avatar_url ? (
                      <img src={member.avatar_url} alt={member.display_name ?? member.user_id} className="h-9 w-9 rounded-full object-cover" />
                    ) : (
                      <div className="h-9 w-9 rounded-full bg-muted flex items-center justify-center text-[11px] font-bold text-foreground">
                        {initials(member.display_name ?? member.user_id)}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-foreground truncate">
                        {member.display_name ?? member.user_id}
                      </p>
                      <p className="text-[10px] text-muted-foreground capitalize">
                        {member.role.replace('_', ' ')}
                      </p>
                    </div>
                  </div>
                ))
              )}
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
              <PolicyBadge icon={Forward} label="Forwarding allowed" enabled={!(policy?.disable_forwarding ?? false)} />
              <PolicyBadge icon={Shield} label="Strip sender on forward" enabled={policy?.strip_forward_sender_identity ?? false} />
              <PolicyBadge icon={Copy} label="History searchable" enabled={policy?.history_searchable ?? false} />
              <PolicyBadge icon={Download} label="Export allowed" enabled={!(policy?.disable_export ?? false)} />
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
            <button
              onClick={() => { void handleExportTranscript(); }}
              disabled={!exportAllowed}
              className={cn(
                'flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-sm transition-colors',
                exportAllowed
                  ? 'hover:bg-muted text-foreground'
                  : 'text-muted-foreground/50 cursor-not-allowed',
              )}
            >
              <Download className="h-4 w-4 text-muted-foreground" />
              Export transcript
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
