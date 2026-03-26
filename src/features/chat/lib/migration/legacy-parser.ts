import { parseMsg } from '@/features/chat/lib/message-codec';

export type CanonicalLegacyType =
  | 'text'
  | 'reply'
  | 'forward'
  | 'edited'
  | 'scheduled'
  | 'poll'
  | 'voice'
  | 'system'
  | 'image'
  | 'vanish';

export interface CanonicalLegacyContent {
  type: CanonicalLegacyType;
  body: string;
  bodyJson: Record<string, unknown>;
}

export function parseLegacyContent(raw: string): CanonicalLegacyContent {
  const parsed = parseMsg(raw);

  if (raw.startsWith('||IMAGE||')) {
    return {
      type: 'image',
      body: '',
      bodyJson: { imageDataUrl: raw.replace('||IMAGE||', '') },
    };
  }

  if (raw.startsWith('||VANISH||')) {
    return {
      type: 'vanish',
      body: raw.replace('||VANISH||', ''),
      bodyJson: { ttlSeconds: 5 },
    };
  }

  if (parsed.isSystemEvent) {
    return {
      type: 'system',
      body: parsed.text,
      bodyJson: { eventType: parsed.systemEventType, fields: parsed.systemEventFields ?? [] },
    };
  }

  if (parsed.isVoice) {
    return {
      type: 'voice',
      body: '',
      bodyJson: {
        duration: parsed.voiceDuration ?? 0,
        audioBase64: parsed.voiceBase64 ?? '',
      },
    };
  }

  if (parsed.isPoll) {
    return {
      type: 'poll',
      body: parsed.pollQuestion ?? '',
      bodyJson: { options: parsed.pollOptions ?? [] },
    };
  }

  if (parsed.isScheduled) {
    return {
      type: 'scheduled',
      body: parsed.text,
      bodyJson: { scheduledFor: parsed.schedAt ?? null },
    };
  }

  if (parsed.isReply) {
    return {
      type: 'reply',
      body: parsed.text,
      bodyJson: {
        replyToLegacyId: parsed.replyId ?? null,
        replySender: parsed.replySender ?? null,
        replyPreview: parsed.replyPreview ?? null,
      },
    };
  }

  if (parsed.isFwd) {
    return {
      type: 'forward',
      body: parsed.text,
      bodyJson: {
        originalSender: parsed.fwdSender ?? null,
        originalBody: parsed.fwdText ?? null,
      },
    };
  }

  if (parsed.isEdited) {
    return {
      type: 'edited',
      body: parsed.text,
      bodyJson: { editedAt: parsed.editedAt ?? null },
    };
  }

  return {
    type: 'text',
    body: parsed.text,
    bodyJson: {},
  };
}
