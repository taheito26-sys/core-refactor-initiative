import { describe, expect, it } from 'vitest';
import { shouldAutoMarkSeen, shouldIncrementChatBadge } from '@/features/chat/attention';

describe('chat attention suppression rules', () => {
  it('does not increment badge for same active conversation when focused and at bottom', () => {
    const result = shouldIncrementChatBadge({
      activeModule: 'chat',
      activeConversationId: 'rel-a',
      incomingConversationId: 'rel-a',
      isWindowFocused: true,
      isMessageListAtBottom: true,
    });
    expect(result).toBe(false);
    expect(shouldAutoMarkSeen({
      activeModule: 'chat',
      activeConversationId: 'rel-a',
      incomingConversationId: 'rel-a',
      isWindowFocused: true,
      isMessageListAtBottom: true,
    })).toBe(true);
  });

  it('increments for different conversation while in chat', () => {
    const result = shouldIncrementChatBadge({
      activeModule: 'chat',
      activeConversationId: 'rel-a',
      incomingConversationId: 'rel-b',
      isWindowFocused: true,
      isMessageListAtBottom: true,
    });
    expect(result).toBe(true);
  });

  it('increments for same conversation when app is blurred', () => {
    const result = shouldIncrementChatBadge({
      activeModule: 'chat',
      activeConversationId: 'rel-a',
      incomingConversationId: 'rel-a',
      isWindowFocused: false,
      isMessageListAtBottom: true,
    });
    expect(result).toBe(true);
  });

  it('increments while user is outside chat module', () => {
    const result = shouldIncrementChatBadge({
      activeModule: 'other',
      activeConversationId: 'rel-a',
      incomingConversationId: 'rel-a',
      isWindowFocused: true,
      isMessageListAtBottom: true,
    });
    expect(result).toBe(true);
  });
});
