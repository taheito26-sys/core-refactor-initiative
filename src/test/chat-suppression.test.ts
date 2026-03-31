import { describe, expect, it } from 'vitest';
import { isViewingConversationMessage } from '@/lib/chat-store';

describe('chat suppression', () => {
  it('suppresses when active conversation is visible and focused', () => {
    expect(isViewingConversationMessage({
      activeConversationId: 'room-1',
      attention: { appFocused: true, inChatModule: true, activeConversationVisible: true },
    }, 'room-1')).toBe(true);
  });

  it('does not suppress for another conversation', () => {
    expect(isViewingConversationMessage({
      activeConversationId: 'room-1',
      attention: { appFocused: true, inChatModule: true, activeConversationVisible: true },
    }, 'room-2')).toBe(false);
  });
});
