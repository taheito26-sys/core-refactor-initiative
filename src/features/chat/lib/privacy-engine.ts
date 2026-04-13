// ─── Privacy Engine — Phases 6-25 ────────────────────────────────────────
// Centralized privacy logic for screenshot detection, DLP, and user privacy

import { supabase } from '@/integrations/supabase/client';

// ── Phase 5/6: Audit event logger ─────────────────────────────────────────
export async function logPrivacyEvent(
  userId: string,
  eventType: string,
  roomId?: string | null,
  metadata: Record<string, unknown> = {},
) {
  try {
    await supabase.from('chat_audit_events').insert({
      user_id: userId,
      room_id: roomId ?? null,
      event_type: eventType,
      metadata: { ...metadata, ts: Date.now() },
    });
  } catch {
    // silent — audit is best-effort
  }
}

// ── Phase 6: Screenshot detection ─────────────────────────────────────────
export function detectScreenshotKeys(callback: () => void): () => void {
  const handler = (e: KeyboardEvent) => {
    // PrintScreen
    if (e.key === 'PrintScreen') {
      callback();
      return;
    }
    // macOS screenshot: Cmd+Shift+3, Cmd+Shift+4, Cmd+Shift+5
    if (e.metaKey && e.shiftKey && ['3', '4', '5'].includes(e.key)) {
      callback();
      return;
    }
    // Windows: Win+Shift+S (Snipping Tool)
    if (e.metaKey && e.shiftKey && e.key.toLowerCase() === 's') {
      callback();
    }
  };
  window.addEventListener('keydown', handler, true);
  return () => window.removeEventListener('keydown', handler, true);
}

// ── Phase 8: CSS protection utilities ─────────────────────────────────────
export function applyScreenshotProtection(el: HTMLElement | null) {
  if (!el) return;
  el.style.userSelect = 'none';
  el.style.webkitUserSelect = 'none';
  el.addEventListener('contextmenu', preventContextMenu);
}

export function removeScreenshotProtection(el: HTMLElement | null) {
  if (!el) return;
  el.style.userSelect = '';
  el.style.webkitUserSelect = '';
  el.removeEventListener('contextmenu', preventContextMenu);
}

function preventContextMenu(e: Event) {
  e.preventDefault();
}

// ── Phase 9: Window focus blur detection ──────────────────────────────────
export function detectWindowBlur(
  onBlur: () => void,
  onFocus: () => void,
): () => void {
  const handleBlur = () => onBlur();
  const handleFocus = () => onFocus();
  window.addEventListener('blur', handleBlur);
  window.addEventListener('focus', handleFocus);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) onBlur();
    else onFocus();
  });
  return () => {
    window.removeEventListener('blur', handleBlur);
    window.removeEventListener('focus', handleFocus);
  };
}

// ── Phase 10: Prevent image drag-to-desktop ──────────────────────────────
export function preventImageDrag(el: HTMLElement | null) {
  if (!el) return;
  el.setAttribute('draggable', 'false');
  el.addEventListener('dragstart', (e) => e.preventDefault());
}

// ── Phase 11: View-once hardening ─────────────────────────────────────────
export function purgeViewOnceFromCache(messageId: string) {
  // Clear from any local cache / sessionStorage
  try {
    sessionStorage.removeItem(`msg_${messageId}`);
    sessionStorage.removeItem(`att_${messageId}`);
  } catch { /* */ }
}

// ── Phase 13: Forwarding controls ─────────────────────────────────────────
export interface ForwardingPolicy {
  allowForwarding: boolean;
  stripSenderIdentity: boolean;
  maxForwardHops: number;
}

export function getForwardingPolicy(
  roomPolicy?: { disable_forwarding?: boolean; disable_copy?: boolean } | null,
): ForwardingPolicy {
  return {
    allowForwarding: !(roomPolicy?.disable_forwarding ?? false),
    stripSenderIdentity: roomPolicy?.disable_copy ?? false,
    maxForwardHops: 5,
  };
}

export function countForwardHops(metadata?: Record<string, unknown>): number {
  if (!metadata?.forwarded_from) return 0;
  return ((metadata.forward_hop_count as number) ?? 0) + 1;
}

// ── Phase 14: Copy protection ─────────────────────────────────────────────
export function blockCopyShortcuts(
  el: HTMLElement | null,
  callback?: () => void,
): () => void {
  if (!el) return () => {};
  const handler = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
      e.preventDefault();
      callback?.();
    }
  };
  el.addEventListener('keydown', handler);
  return () => el.removeEventListener('keydown', handler);
}

// ── Phase 16: File validation ─────────────────────────────────────────────
export interface FileValidationResult {
  ok: boolean;
  error?: string;
}

const DANGEROUS_EXTENSIONS = ['.exe', '.bat', '.cmd', '.msi', '.ps1', '.sh', '.jar', '.scr', '.com'];

export function validateFileUpload(
  file: File,
  policy?: {
    allowed_mime_types?: string[] | null;
    max_file_size_mb?: number;
  },
): FileValidationResult {
  // Extension check
  const ext = '.' + file.name.split('.').pop()?.toLowerCase();
  if (DANGEROUS_EXTENSIONS.includes(ext)) {
    return { ok: false, error: `File type "${ext}" is not allowed for security reasons` };
  }

  // MIME type verification (Phase 16: not just extension)
  if (policy?.allowed_mime_types && policy.allowed_mime_types.length > 0) {
    const allowed = policy.allowed_mime_types.some((mime) => {
      if (mime.endsWith('/*')) return file.type.startsWith(mime.replace('/*', '/'));
      return file.type === mime;
    });
    if (!allowed) {
      return { ok: false, error: `File type "${file.type}" is not allowed in this room` };
    }
  }

  // Size check
  const maxMb = policy?.max_file_size_mb ?? 50;
  if (file.size > maxMb * 1024 * 1024) {
    return { ok: false, error: `File exceeds maximum size of ${maxMb}MB` };
  }

  return { ok: true };
}

// ── Phase 17: Sensitive data detection (DLP) ─────────────────────────────
export interface SensitiveDataResult {
  hasSensitiveData: boolean;
  detections: SensitiveDetection[];
}

export interface SensitiveDetection {
  type: 'credit_card' | 'phone' | 'email' | 'ssn' | 'iban';
  match: string;
  masked: string;
}

const PATTERNS: { type: SensitiveDetection['type']; regex: RegExp; mask: (m: string) => string }[] = [
  {
    type: 'credit_card',
    regex: /\b(?:\d[ -]*?){13,19}\b/g,
    mask: (m) => m.replace(/\d/g, '•').slice(0, -4) + m.slice(-4),
  },
  {
    type: 'email',
    regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
    mask: (m) => m[0] + '•••@' + m.split('@')[1],
  },
  {
    type: 'phone',
    regex: /(?:\+\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}/g,
    mask: (m) => m.slice(0, 3) + '•••' + m.slice(-3),
  },
  {
    type: 'iban',
    regex: /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g,
    mask: (m) => m.slice(0, 4) + '•'.repeat(m.length - 8) + m.slice(-4),
  },
];

export function detectSensitiveData(text: string): SensitiveDataResult {
  const detections: SensitiveDetection[] = [];

  for (const { type, regex, mask } of PATTERNS) {
    const matches = text.match(regex);
    if (matches) {
      for (const match of matches) {
        // Filter out false positives (too short for credit cards, etc.)
        if (type === 'credit_card' && match.replace(/\D/g, '').length < 13) continue;
        if (type === 'phone' && match.replace(/\D/g, '').length < 7) continue;
        detections.push({ type, match, masked: mask(match) });
      }
    }
  }

  return { hasSensitiveData: detections.length > 0, detections };
}

// ── Phase 18: Retention policy helpers ───────────────────────────────────
export function retentionLabel(hours: number | null): string {
  if (!hours) return 'Indefinite';
  if (hours <= 24) return `${hours}h`;
  if (hours <= 168) return `${Math.round(hours / 24)}d`;
  if (hours <= 720) return `${Math.round(hours / 168)}w`;
  return `${Math.round(hours / 720)}mo`;
}

export function isMessageExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt) < new Date();
}

// ── Phase 19: Export controls ────────────────────────────────────────────
export interface ExportPolicy {
  allowExport: boolean;
  redactSensitive: boolean;
}

export function getExportPolicy(
  roomPolicy?: { disable_export?: boolean } | null,
): ExportPolicy {
  return {
    allowExport: !(roomPolicy?.disable_export ?? false),
    redactSensitive: true,
  };
}

// ── Phase 20: Attachment lifecycle ──────────────────────────────────────
export function isAttachmentExpired(createdAt: string, ttlHours: number): boolean {
  const created = new Date(createdAt).getTime();
  const now = Date.now();
  return now - created > ttlHours * 3600 * 1000;
}

// ── Phase 22: Presence privacy levels ───────────────────────────────────
export type PresenceVisibility = 'everyone' | 'room_members' | 'nobody';
export type LastSeenVisibility = 'everyone' | 'contacts' | 'nobody';

export interface PresencePrivacySettings {
  onlineVisibility: PresenceVisibility;
  lastSeenVisibility: LastSeenVisibility;
  typingVisible: boolean;
  readReceiptsVisible: boolean;
  invisibleMode: boolean;
}

export const DEFAULT_PRESENCE_PRIVACY: PresencePrivacySettings = {
  onlineVisibility: 'everyone',
  lastSeenVisibility: 'everyone',
  typingVisible: true,
  readReceiptsVisible: true,
  invisibleMode: false,
};

// ── Phase 23: Notification privacy levels ───────────────────────────────
export type NotificationPreview = 'full' | 'sender_only' | 'none';

export interface NotificationPrivacySettings {
  previewLevel: NotificationPreview;
  showSenderName: boolean;
  showContent: boolean;
}

export const DEFAULT_NOTIFICATION_PRIVACY: NotificationPrivacySettings = {
  previewLevel: 'full',
  showSenderName: true,
  showContent: true,
};

// ── Phase 25: Privacy score calculator ──────────────────────────────────
export function calculatePrivacyScore(settings: {
  watermarkEnabled?: boolean;
  screenshotProtection?: boolean;
  encryptionMode?: string;
  readReceiptsHidden?: boolean;
  lastSeenHidden?: boolean;
  typingHidden?: boolean;
  notificationPreview?: NotificationPreview;
  invisibleMode?: boolean;
  retentionEnabled?: boolean;
  forwardingDisabled?: boolean;
  copyDisabled?: boolean;
  exportDisabled?: boolean;
}): { score: number; maxScore: number; percentage: number; label: string } {
  let score = 0;
  const maxScore = 12;

  if (settings.watermarkEnabled) score++;
  if (settings.screenshotProtection) score++;
  if (settings.encryptionMode === 'client_e2ee') score += 2;
  else if (settings.encryptionMode === 'server_e2ee') score++;
  if (settings.readReceiptsHidden) score++;
  if (settings.lastSeenHidden) score++;
  if (settings.typingHidden) score++;
  if (settings.notificationPreview === 'none') score++;
  if (settings.invisibleMode) score++;
  if (settings.retentionEnabled) score++;
  if (settings.forwardingDisabled) score++;
  if (settings.copyDisabled) score++;
  if (settings.exportDisabled) score++;

  const percentage = Math.round((score / maxScore) * 100);
  const label = percentage >= 80 ? 'Maximum' : percentage >= 50 ? 'Strong' : percentage >= 25 ? 'Moderate' : 'Basic';

  return { score, maxScore, percentage, label };
}
