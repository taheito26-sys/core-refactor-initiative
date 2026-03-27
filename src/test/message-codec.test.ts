import { describe, it, expect } from 'vitest';
import { parseMsg, encodeVoice } from '../features/chat/lib/message-codec';

describe('message-codec', () => {
  it('should parse voice messages correctly', () => {
    const duration = 15;
    const b64 = 'SGVsbG8='; // "Hello"
    const encoded = encodeVoice(duration, b64);
    const parsed = parseMsg(encoded);
    
    expect(parsed.isVoice).toBe(true);
    expect(parsed.voiceDuration).toBe(duration);
    expect(parsed.voiceBase64).toBe(b64);
  });

  it('should identify viewed messages', () => {
    const raw = 'Hello world||VIEWED||2026-03-27T12:00:00Z||/VIEWED||';
    const parsed = parseMsg(raw);
    
    expect(parsed.isViewed).toBe(true);
    expect(parsed.text).toBe('Hello world');
  });

  it('should parse poll messages', () => {
    const raw = '||POLL||Question?||~||OptA;;OptB||/POLL||';
    const parsed = parseMsg(raw);
    
    expect(parsed.isPoll).toBe(true);
    expect(parsed.pollQuestion).toBe('Question?');
    expect(parsed.pollOptions).toEqual(['OptA', 'OptB']);
  });
});
