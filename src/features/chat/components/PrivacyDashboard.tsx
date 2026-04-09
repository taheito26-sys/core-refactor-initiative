// ─── PrivacyDashboard — Phase 25: Centralized privacy settings ──────────
// Phases 15, 21, 22, 23, 24, 25

import { useEffect, useState } from 'react';
import {
  X, Shield, ShieldCheck, ShieldAlert, Eye, EyeOff, Bell, BellOff,
  Lock, Unlock, MessageCircle, Timer, Forward, Copy, Download,
  Fingerprint, User, Zap, CheckCircle2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { calculatePrivacyScore, type NotificationPreview } from '../lib/privacy-engine';
import { usePrivacySettings } from '../hooks/usePrivacySettings';

interface Props {
  onClose: () => void;
}

interface PrivacyState {
  // Phase 15: Read receipt privacy
  hideReadReceipts: boolean;
  hideLastSeen: boolean;
  hideTyping: boolean;
  // Phase 22: Presence privacy
  invisibleMode: boolean;
  onlineVisibility: 'everyone' | 'room_members' | 'nobody';
  // Phase 23: Notification privacy
  notificationPreview: NotificationPreview;
  showSenderInNotification: boolean;
  // Phase 21: Anonymous mode
  anonymousMode: boolean;
  // General
  screenshotProtection: boolean;
  watermarkEnabled: boolean;
  forwardingDisabled: boolean;
  copyDisabled: boolean;
  exportDisabled: boolean;
}

const DEFAULT_STATE: PrivacyState = {
  hideReadReceipts: false,
  hideLastSeen: false,
  hideTyping: false,
  invisibleMode: false,
  onlineVisibility: 'everyone',
  notificationPreview: 'full',
  showSenderInNotification: true,
  anonymousMode: false,
  screenshotProtection: false,
  watermarkEnabled: false,
  forwardingDisabled: false,
  copyDisabled: false,
  exportDisabled: false,
};

function ToggleRow({ label, description, icon: Icon, enabled, onChange, danger }: {
  label: string; description: string; icon: React.ElementType;
  enabled: boolean; onChange: () => void; danger?: boolean;
}) {
  return (
    <button onClick={onChange} className="flex items-start gap-3 w-full px-3 py-2.5 rounded-xl hover:bg-muted/50 transition-colors text-left">
      <div className={cn(
        'h-8 w-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5',
        enabled
          ? danger ? 'bg-destructive/15 text-destructive' : 'bg-primary/15 text-primary'
          : 'bg-muted text-muted-foreground/50',
      )}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-foreground">{label}</p>
        <p className="text-[10px] text-muted-foreground/70 mt-0.5 leading-relaxed">{description}</p>
      </div>
      <div className={cn(
        'w-9 h-5 rounded-full relative transition-colors shrink-0 mt-1',
        enabled ? 'bg-primary' : 'bg-muted-foreground/20',
      )}>
        <div className={cn(
          'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform',
          enabled ? 'translate-x-4' : 'translate-x-0.5',
        )} />
      </div>
    </button>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground/50 px-3 pt-4 pb-1">
      {title}
    </p>
  );
}

export function PrivacyDashboard({ onClose }: Props) {
  const { settings, update, isUpdating } = usePrivacySettings();
  const [state, setState] = useState<PrivacyState>(DEFAULT_STATE);

  useEffect(() => {
    setState({
      hideReadReceipts: settings.hide_read_receipts,
      hideLastSeen: settings.hide_last_seen,
      hideTyping: settings.hide_typing,
      invisibleMode: settings.invisible_mode,
      onlineVisibility: settings.online_visibility,
      notificationPreview: settings.notification_preview,
      showSenderInNotification: settings.show_sender_in_notification,
      anonymousMode: settings.anonymous_mode,
      screenshotProtection: settings.screenshot_protection,
      watermarkEnabled: settings.watermark_enabled,
      forwardingDisabled: settings.forwarding_disabled,
      copyDisabled: settings.copy_disabled,
      exportDisabled: settings.export_disabled,
    });
  }, [settings]);

  const patchState = async (patch: Partial<PrivacyState>) => {
    const next = { ...state, ...patch };
    setState(next);
    await update({
      hide_read_receipts: next.hideReadReceipts,
      hide_last_seen: next.hideLastSeen,
      hide_typing: next.hideTyping,
      invisible_mode: next.invisibleMode,
      online_visibility: next.onlineVisibility,
      notification_preview: next.notificationPreview,
      show_sender_in_notification: next.showSenderInNotification,
      anonymous_mode: next.anonymousMode,
      screenshot_protection: next.screenshotProtection,
      watermark_enabled: next.watermarkEnabled,
      forwarding_disabled: next.forwardingDisabled,
      copy_disabled: next.copyDisabled,
      export_disabled: next.exportDisabled,
    });
  };

  // Phase 25: Maximum privacy preset
  const applyMaxPrivacy = async () => {
    const maxState: PrivacyState = {
      hideReadReceipts: true,
      hideLastSeen: true,
      hideTyping: true,
      invisibleMode: true,
      onlineVisibility: 'nobody',
      notificationPreview: 'none',
      showSenderInNotification: false,
      anonymousMode: false,
      screenshotProtection: true,
      watermarkEnabled: true,
      forwardingDisabled: true,
      copyDisabled: true,
      exportDisabled: true,
    };
    setState(maxState);
    await update({
      hide_read_receipts: true,
      hide_last_seen: true,
      hide_typing: true,
      invisible_mode: true,
      online_visibility: 'nobody',
      notification_preview: 'none',
      show_sender_in_notification: false,
      anonymous_mode: false,
      screenshot_protection: true,
      watermark_enabled: true,
      forwarding_disabled: true,
      copy_disabled: true,
      export_disabled: true,
    });
  };

  const score = calculatePrivacyScore({
    watermarkEnabled: state.watermarkEnabled,
    screenshotProtection: state.screenshotProtection,
    readReceiptsHidden: state.hideReadReceipts,
    lastSeenHidden: state.hideLastSeen,
    typingHidden: state.hideTyping,
    notificationPreview: state.notificationPreview,
    invisibleMode: state.invisibleMode,
    forwardingDisabled: state.forwardingDisabled,
    copyDisabled: state.copyDisabled,
    exportDisabled: state.exportDisabled,
  });

  const ScoreIcon = score.percentage >= 80 ? ShieldCheck : score.percentage >= 50 ? Shield : ShieldAlert;
  const scoreColor = score.percentage >= 80 ? 'text-emerald-500' : score.percentage >= 50 ? 'text-amber-500' : 'text-destructive';

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-50 animate-in fade-in-0 duration-150" onClick={onClose} />
      <div className="fixed right-0 top-0 bottom-0 w-96 max-w-[90vw] bg-card border-l border-border z-50 flex flex-col animate-in slide-in-from-right duration-200 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-bold text-foreground">Privacy & Security</h3>
          </div>
          <button onClick={onClose} className="h-8 w-8 rounded-lg hover:bg-muted flex items-center justify-center text-muted-foreground transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Phase 25: Privacy score */}
          <div className="px-4 py-4 border-b border-border/50">
            <div className="flex items-center gap-3 mb-3">
              <div className={cn('h-12 w-12 rounded-2xl flex items-center justify-center', scoreColor, 'bg-current/10')}>
                <ScoreIcon className="h-6 w-6" />
              </div>
              <div>
                <p className="text-lg font-black text-foreground">{score.percentage}%</p>
                <p className={cn('text-xs font-semibold', scoreColor)}>{score.label} Privacy</p>
              </div>
            </div>
            {/* Progress bar */}
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className={cn('h-full rounded-full transition-all duration-500',
                  score.percentage >= 80 ? 'bg-emerald-500' : score.percentage >= 50 ? 'bg-amber-500' : 'bg-destructive',
                )}
                style={{ width: `${score.percentage}%` }}
              />
            </div>
            <button onClick={() => void applyMaxPrivacy()}
              disabled={isUpdating}
              className="mt-3 w-full flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-xs font-bold bg-primary/10 text-primary hover:bg-primary/20 transition-colors">
              <Zap className="h-3.5 w-3.5" />
              Enable Maximum Privacy
            </button>
          </div>

          {/* Phase 15: Read receipts & activity */}
          <SectionHeader title="Activity & Receipts" />
          <div className="px-1">
            <ToggleRow icon={CheckCircle2} label="Hide read receipts"
              description="Others won't see when you've read their messages"
              enabled={state.hideReadReceipts} onChange={() => void patchState({ hideReadReceipts: !state.hideReadReceipts })} />
            <ToggleRow icon={Timer} label="Hide last seen"
              description="Your last active time won't be visible to others"
              enabled={state.hideLastSeen} onChange={() => void patchState({ hideLastSeen: !state.hideLastSeen })} />
            <ToggleRow icon={MessageCircle} label="Hide typing indicator"
              description="Others won't see when you're typing a message"
              enabled={state.hideTyping} onChange={() => void patchState({ hideTyping: !state.hideTyping })} />
          </div>

          {/* Phase 22: Presence */}
          <SectionHeader title="Online Presence" />
          <div className="px-1">
            <ToggleRow icon={EyeOff} label="Invisible mode"
              description="Appear offline while still receiving messages"
              enabled={state.invisibleMode} onChange={() => void patchState({ invisibleMode: !state.invisibleMode })} />
          </div>

          {/* Phase 23: Notifications */}
          <SectionHeader title="Notification Privacy" />
          <div className="px-1">
            <ToggleRow icon={BellOff} label="Hide notification content"
              description="Show 'New message' instead of message preview"
              enabled={state.notificationPreview === 'none'}
              onChange={() => void patchState({
                notificationPreview: (state.notificationPreview === 'none' ? 'full' : 'none') as NotificationPreview,
              })} />
            <ToggleRow icon={User} label="Hide sender name"
              description="Don't show who sent the message in notifications"
              enabled={!state.showSenderInNotification}
              onChange={() => void patchState({ showSenderInNotification: !state.showSenderInNotification })} />
          </div>

          {/* Phase 24: Encryption & Protection */}
          <SectionHeader title="Content Protection" />
          <div className="px-1">
            <ToggleRow icon={Lock} label="Screenshot protection"
              description="Detect screenshots and blur content when window loses focus"
              enabled={state.screenshotProtection} onChange={() => void patchState({ screenshotProtection: !state.screenshotProtection })} />
            <ToggleRow icon={Fingerprint} label="Watermark overlay"
              description="Add invisible watermark to sensitive message areas"
              enabled={state.watermarkEnabled} onChange={() => void patchState({ watermarkEnabled: !state.watermarkEnabled })} />
            <ToggleRow icon={Forward} label="Disable forwarding"
              description="Prevent messages from being forwarded to other rooms"
              enabled={state.forwardingDisabled} onChange={() => void patchState({ forwardingDisabled: !state.forwardingDisabled })} danger />
            <ToggleRow icon={Copy} label="Disable copy"
              description="Block text copying from messages in protected rooms"
              enabled={state.copyDisabled} onChange={() => void patchState({ copyDisabled: !state.copyDisabled })} danger />
            <ToggleRow icon={Download} label="Disable export"
              description="Prevent chat export and transcript downloads"
              enabled={state.exportDisabled} onChange={() => void patchState({ exportDisabled: !state.exportDisabled })} danger />
          </div>

          {/* Phase 21: Anonymous mode */}
          <SectionHeader title="Identity" />
          <div className="px-1 pb-6">
            <ToggleRow icon={User} label="Anonymous mode"
              description="Use a pseudonymous name in new rooms you join"
              enabled={state.anonymousMode} onChange={() => void patchState({ anonymousMode: !state.anonymousMode })} />
          </div>
        </div>
      </div>
    </>
  );
}
