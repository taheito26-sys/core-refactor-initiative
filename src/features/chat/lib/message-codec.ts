/* ═══════════════════════════════════════════════════════════════
   Message Codec — encoding & parsing for rich message metadata
   Extracted from UnifiedChatInbox.tsx for reuse across components
   ═══════════════════════════════════════════════════════════════ */

const SEP = '||~||';

// ── Encoders ─────────────────────────────────────────────────────

export function encodeReply(replyId: string, sender: string, preview: string, text: string): string {
  return `||REPLY||${replyId}${SEP}${sender}${SEP}${preview.slice(0, 120).replace(/\|\|/g, '|')}||/REPLY||\n${text}`;
}

export function encodeForward(originalSender: string, originalText: string, newText: string): string {
  return `||FWD||${originalSender}${SEP}${originalText.slice(0, 200).replace(/\|\|/g, '|')}||/FWD||\n${newText}`;
}

export function encodeEdited(text: string, ts: string): string {
  return `${text}||EDITED||${ts}`;
}

export function encodeScheduled(sendAt: string, content: string): string {
  return `||SCHED||${sendAt}${SEP}${content}||/SCHED||`;
}

export function encodePoll(question: string, opts: string[]): string {
  return `||POLL||${question}${SEP}${opts.join(';;')}||/POLL||`;
}

export function encodeVoice(durationSec: number, base64: string): string {
  return `||VOICE||${durationSec}${SEP}${base64}||/VOICE||`;
}

export function encodeSystemEvent(type: string, ...fields: string[]): string {
  return `||SYS_${type.toUpperCase()}||${fields.join(SEP)}||/SYS_${type.toUpperCase()}||`;
}

// ── Parsed result ────────────────────────────────────────────────

export interface ParsedMessage {
  // Reply
  isReply: boolean;
  replyId?: string;
  replySender?: string;
  replyPreview?: string;
  // Forward
  isFwd: boolean;
  fwdSender?: string;
  fwdText?: string;
  // Poll
  isPoll: boolean;
  pollQuestion?: string;
  pollOptions?: string[];
  // Scheduled
  isScheduled: boolean;
  schedAt?: string;
  // Voice
  isVoice: boolean;
  voiceDuration?: number;
  voiceBase64?: string;
  // System event
  isSystemEvent: boolean;
  systemEventType?: string;
  systemEventFields?: string[];
  // Text
  text: string;
  isEdited: boolean;
  editedAt?: string;
  // One-time / viewed state
  isOneTime?: boolean;
  isViewed?: boolean;
  expiresAt?: string;
}

// ── Parser ───────────────────────────────────────────────────────

export function parseMsg(raw: string): ParsedMessage {
  let text = raw;
  let isReply = false, replyId: string | undefined, replySender: string | undefined, replyPreview: string | undefined;
  let isFwd = false, fwdSender: string | undefined, fwdText: string | undefined;
  let isPoll = false, pollQuestion: string | undefined, pollOptions: string[] | undefined;
  let isScheduled = false, schedAt: string | undefined;
  let isVoice = false, voiceDuration: number | undefined, voiceBase64: string | undefined;
  let isSystemEvent = false, systemEventType: string | undefined, systemEventFields: string[] | undefined;
  let isEdited = false, editedAt: string | undefined;

  // Voice
  if (text.startsWith('||VOICE||')) {
    const end = text.indexOf('||/VOICE||');
    const payload = end !== -1 ? text.slice(9, end) : text.slice(9);
    const meta = payload.split(SEP);
    voiceDuration = Number(meta[0]) || 0;
    voiceBase64 = meta.slice(1).join(SEP) || '';
    text = '';
    isVoice = true;
  }
  // Reply
  else if (text.startsWith('||REPLY||')) {
    const end = text.indexOf('||/REPLY||\n');
    if (end !== -1) {
      const meta = text.slice(9, end).split(SEP);
      replyId = meta[0]; replySender = meta[1]; replyPreview = meta[2];
      text = text.slice(end + 11); isReply = true;
    }
  }
  // Forward
  else if (text.startsWith('||FWD||')) {
    const end = text.indexOf('||/FWD||\n');
    if (end !== -1) {
      const meta = text.slice(7, end).split(SEP);
      fwdSender = meta[0]; fwdText = meta[1];
      text = text.slice(end + 9); isFwd = true;
    }
  }
  // Poll
  else if (text.startsWith('||POLL||')) {
    const end = text.indexOf('||/POLL||');
    const payload = end !== -1 ? text.slice(8, end) : text.slice(8);
    const meta = payload.split(SEP);
    pollQuestion = meta[0]; pollOptions = meta[1]?.split(';;') || [];
    text = ''; isPoll = true;
  }
  // Scheduled
  else if (text.startsWith('||SCHED||')) {
    const end = text.indexOf('||/SCHED||');
    const payload = end !== -1 ? text.slice(9, end) : text.slice(9);
    const meta = payload.split(SEP);
    schedAt = meta[0]; text = meta[1] || ''; isScheduled = true;
  }
  // System event (generic: ||SYS_ORDER||...||/SYS_ORDER||)
  else if (text.startsWith('||SYS_')) {
    const typeEnd = text.indexOf('||', 6);
    if (typeEnd !== -1) {
      const eventType = text.slice(6, typeEnd);
      const closeTag = `||/SYS_${eventType}||`;
      const end = text.indexOf(closeTag);
      if (end !== -1) {
        const inner = text.slice(typeEnd + 2, end);
        systemEventType = eventType.toLowerCase();
        systemEventFields = inner.split(SEP);
        text = ''; isSystemEvent = true;
      }
    }
  }

  // Edited marker (can appear on any text message)
  const editIdx = text.lastIndexOf('||EDITED||');
  if (editIdx !== -1) {
    editedAt = text.slice(editIdx + 10); text = text.slice(0, editIdx); isEdited = true;
  }

  // Viewed marker (generic: ||VIEWED||ts||/VIEWED||)
  let isViewed = false;
  const viewedIdx = raw.indexOf('||VIEWED||');
  if (viewedIdx !== -1) {
    isViewed = true;
    const viewedEndIdx = raw.indexOf('||/VIEWED||');
    if (viewedEndIdx !== -1) {
      // Strip it from text if it's at the end or integrated
      text = text.replace(/\|\|VIEWED\|\|.*?\|\|\/VIEWED\|\|/, '').trim();
    }
  }

  return {
    isReply, replyId, replySender, replyPreview,
    isFwd, fwdSender, fwdText,
    isPoll, pollQuestion, pollOptions,
    isScheduled, schedAt,
    isVoice, voiceDuration, voiceBase64,
    isSystemEvent, systemEventType, systemEventFields,
    text, isEdited, editedAt,
    isViewed
  };
}

// ── Link rendering helper ────────────────────────────────────────

const URL_RE = /(https?:\/\/[^\s]+)/g;

export function splitLinks(text: string): Array<{ type: 'text' | 'link'; value: string }> {
  const parts: Array<{ type: 'text' | 'link'; value: string }> = [];
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  URL_RE.lastIndex = 0;
  while ((match = URL_RE.exec(text)) !== null) {
    if (match.index > lastIdx) {
      parts.push({ type: 'text', value: text.slice(lastIdx, match.index) });
    }
    parts.push({ type: 'link', value: match[0] });
    lastIdx = match.index + match[0].length;
  }
  if (lastIdx < text.length) {
    parts.push({ type: 'text', value: text.slice(lastIdx) });
  }
  return parts;
}

// ── Time formatters ──────────────────────────────────────────────

export function fmtListTime(s: string | null | undefined): string {
  if (!s) return '—';
  const d = new Date(s);
  if (isNaN(d.getTime())) return '—';
  const diff = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (diff === 0) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function fmtMsgTime(s: string | null | undefined): string {
  if (!s) return '--:--';
  const d = new Date(s);
  if (isNaN(d.getTime())) return '--:--';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function fmtDateSeparator(s: string | null | undefined): string {
  if (!s) return 'Unknown Date';
  const d = new Date(s);
  if (isNaN(d.getTime())) return 'Unknown Date';
  const now = new Date();
  const diff = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
}

// ── Color palette for conversation avatars ───────────────────────

const PALETTES = [
  { bg: 'linear-gradient(135deg,#7c3aed,#6d28d9)', text: '#fff' },
  { bg: 'linear-gradient(135deg,#0891b2,#0e7490)', text: '#fff' },
  { bg: 'linear-gradient(135deg,#059669,#047857)', text: '#fff' },
  { bg: 'linear-gradient(135deg,#d97706,#b45309)', text: '#fff' },
  { bg: 'linear-gradient(135deg,#db2777,#be185d)', text: '#fff' },
  { bg: 'linear-gradient(135deg,#2563eb,#1d4ed8)', text: '#fff' },
];

export function getPalette(name: string | null | undefined) {
  const safeName = name || 'Anonymous';
  return PALETTES[safeName.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % PALETTES.length];
}

// ── Message grouping by date ─────────────────────────────────────

export function groupMessagesByDate<T extends { created_at: string }>(
  messages: T[]
): Array<{ date: string; label: string; messages: T[] }> {
  const groups: Array<{ date: string; label: string; messages: T[] }> = [];
  let currentDate = '';

  for (const msg of messages) {
    const dateStr = new Date(msg.created_at).toDateString();
    if (dateStr !== currentDate) {
      currentDate = dateStr;
      groups.push({
        date: dateStr,
        label: fmtDateSeparator(msg.created_at),
        messages: [msg],
      });
    } else {
      groups[groups.length - 1].messages.push(msg);
    }
  }

  return groups;
}
