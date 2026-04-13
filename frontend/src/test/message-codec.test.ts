import { describe, it, expect } from 'vitest';
import {
  parseMsg,
  encodeVoice,
  encodePoll,
  encodeReply,
  encodeForward,
  encodeEdited,
  encodeScheduled,
  encodeSystemEvent,
  splitLinks,
} from '../features/chat/lib/message-codec';

describe('message-codec', () => {
  // ── Voice ────────────────────────────────────────────────────
  describe('voice messages', () => {
    it('should round-trip encode → parse', () => {
      const encoded = encodeVoice(15, 'SGVsbG8=');
      const parsed = parseMsg(encoded);
      expect(parsed.isVoice).toBe(true);
      expect(parsed.voiceDuration).toBe(15);
      expect(parsed.voiceBase64).toBe('SGVsbG8=');
      expect(parsed.text).toBe('');
    });

    it('should never fall back to raw string', () => {
      const encoded = encodeVoice(7, 'AAAA');
      const parsed = parseMsg(encoded);
      expect(parsed.isVoice).toBe(true);
      // Text must be empty — raw ||VOICE||... must NOT leak
      expect(parsed.text).not.toContain('||VOICE||');
    });

    it('should handle missing closing tag gracefully', () => {
      const raw = '||VOICE||10||~||base64data';
      const parsed = parseMsg(raw);
      expect(parsed.isVoice).toBe(true);
      expect(parsed.voiceDuration).toBe(10);
      expect(parsed.voiceBase64).toBe('base64data');
    });
  });

  // ── Poll ─────────────────────────────────────────────────────
  describe('poll messages', () => {
    it('should round-trip encode → parse', () => {
      const encoded = encodePoll('Favourite color?', ['Red', 'Blue', 'Green']);
      const parsed = parseMsg(encoded);
      expect(parsed.isPoll).toBe(true);
      expect(parsed.pollQuestion).toBe('Favourite color?');
      expect(parsed.pollOptions).toEqual(['Red', 'Blue', 'Green']);
      expect(parsed.text).toBe('');
    });

    it('should never fall back to raw string', () => {
      const encoded = encodePoll('Q?', ['A', 'B']);
      const parsed = parseMsg(encoded);
      expect(parsed.text).not.toContain('||POLL||');
    });

    it('should handle missing closing tag', () => {
      const raw = '||POLL||Question?||~||OptA;;OptB';
      const parsed = parseMsg(raw);
      expect(parsed.isPoll).toBe(true);
      expect(parsed.pollQuestion).toBe('Question?');
      expect(parsed.pollOptions).toEqual(['OptA', 'OptB']);
    });
  });

  // ── Reply ────────────────────────────────────────────────────
  describe('reply messages', () => {
    it('should round-trip encode → parse', () => {
      const encoded = encodeReply('msg-123', 'Alice', 'Original text...', 'My reply');
      const parsed = parseMsg(encoded);
      expect(parsed.isReply).toBe(true);
      expect(parsed.replyId).toBe('msg-123');
      expect(parsed.replySender).toBe('Alice');
      expect(parsed.replyPreview).toBe('Original text...');
      expect(parsed.text).toBe('My reply');
    });

    it('should never show raw tags in text', () => {
      const encoded = encodeReply('id', 'User', 'preview', 'body');
      const parsed = parseMsg(encoded);
      expect(parsed.text).not.toContain('||REPLY||');
      expect(parsed.text).not.toContain('||/REPLY||');
    });
  });

  // ── Forward ──────────────────────────────────────────────────
  describe('forward messages', () => {
    it('should round-trip encode → parse', () => {
      const encoded = encodeForward('Bob', 'Forwarded content', 'Additional note');
      const parsed = parseMsg(encoded);
      expect(parsed.isFwd).toBe(true);
      expect(parsed.fwdSender).toBe('Bob');
      expect(parsed.fwdText).toBe('Forwarded content');
      expect(parsed.text).toBe('Additional note');
    });

    it('should never show raw tags in text', () => {
      const encoded = encodeForward('X', 'Y', 'Z');
      const parsed = parseMsg(encoded);
      expect(parsed.text).not.toContain('||FWD||');
    });
  });

  // ── Edited ───────────────────────────────────────────────────
  describe('edited messages', () => {
    it('should detect edited marker', () => {
      const encoded = encodeEdited('Updated text', '2026-03-27T12:00:00Z');
      const parsed = parseMsg(encoded);
      expect(parsed.isEdited).toBe(true);
      expect(parsed.editedAt).toBe('2026-03-27T12:00:00Z');
      expect(parsed.text).toBe('Updated text');
    });
  });

  // ── Scheduled ────────────────────────────────────────────────
  describe('scheduled messages', () => {
    it('should round-trip encode → parse', () => {
      const encoded = encodeScheduled('2026-04-01T09:00:00Z', 'Reminder!');
      const parsed = parseMsg(encoded);
      expect(parsed.isScheduled).toBe(true);
      expect(parsed.schedAt).toBe('2026-04-01T09:00:00Z');
      expect(parsed.text).toBe('Reminder!');
    });
  });

  // ── System events ────────────────────────────────────────────
  describe('system events', () => {
    it('should encode and parse system events', () => {
      const encoded = encodeSystemEvent('order', 'ORD-1042', 'completed');
      const parsed = parseMsg(encoded);
      expect(parsed.isSystemEvent).toBe(true);
      expect(parsed.systemEventType).toBe('order');
      expect(parsed.systemEventFields).toEqual(['ORD-1042', 'completed']);
      expect(parsed.text).toBe('');
    });
  });

  // ── Viewed (one-time) ────────────────────────────────────────
  describe('viewed messages', () => {
    it('should identify viewed messages', () => {
      const raw = 'Hello world||VIEWED||2026-03-27T12:00:00Z||/VIEWED||';
      const parsed = parseMsg(raw);
      expect(parsed.isViewed).toBe(true);
      expect(parsed.text).toBe('Hello world');
    });
  });

  // ── Plain text ───────────────────────────────────────────────
  describe('plain text', () => {
    it('should pass through plain text unchanged', () => {
      const parsed = parseMsg('Hello world');
      expect(parsed.text).toBe('Hello world');
      expect(parsed.isVoice).toBe(false);
      expect(parsed.isPoll).toBe(false);
      expect(parsed.isReply).toBe(false);
      expect(parsed.isFwd).toBe(false);
      expect(parsed.isSystemEvent).toBe(false);
    });
  });

  // ── Link splitting ──────────────────────────────────────────
  describe('splitLinks', () => {
    it('should split text and links', () => {
      const parts = splitLinks('Check https://example.com for details');
      expect(parts).toEqual([
        { type: 'text', value: 'Check ' },
        { type: 'link', value: 'https://example.com' },
        { type: 'text', value: ' for details' },
      ]);
    });

    it('should handle text without links', () => {
      const parts = splitLinks('No links here');
      expect(parts).toEqual([{ type: 'text', value: 'No links here' }]);
    });
  });
});
