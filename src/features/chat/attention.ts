export interface AttentionState {
  activeModule: 'chat' | 'other';
  activeConversationId: string | null;
  incomingConversationId: string;
  isWindowFocused: boolean;
  isMessageListAtBottom: boolean;
}

export function shouldIncrementChatBadge(state: AttentionState): boolean {
  const sameConversation = state.activeConversationId === state.incomingConversationId;
  if (state.activeModule === 'chat' && sameConversation && state.isWindowFocused && state.isMessageListAtBottom) {
    return false;
  }
  return true;
}

export function shouldAutoMarkSeen(state: AttentionState): boolean {
  return !shouldIncrementChatBadge(state);
}
